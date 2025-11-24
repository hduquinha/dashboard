"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  Controls,
  Edge,
  Node,
  Position,
  useEdgesState,
  useNodesState,
  ReactFlowProvider,
  Handle,
  NodeProps,
  ConnectionLineType,
} from "reactflow";
import "reactflow/dist/style.css";
import dagre from "dagre";
import { NetworkNode } from "@/lib/network";
import InscricaoDetails from "@/components/InscricaoDetails";
import { InscricaoItem } from "@/types/inscricao";
import { TrainingOption } from "@/types/training";
import { Recruiter } from "@/lib/recruiters";

const NODE_WIDTH = 250;
const NODE_HEIGHT = 180;

interface NetworkCanvasProps {
  roots: NetworkNode[];
  trainingOptions: TrainingOption[];
  recruiterOptions: Recruiter[];
}

// Custom Node Component
function CustomNode({ data }: NodeProps<{ node: NetworkNode; onDetails: (id: number) => void }>) {
  const { node, onDetails } = data;
  const isRecruiter = node.tipo === "recrutador";

  return (
    <div
      className={`flex w-[250px] flex-col items-center rounded-xl border-2 bg-white p-4 shadow-md transition hover:shadow-lg ${
        isRecruiter ? "border-emerald-200" : "border-sky-200"
      }`}
    >
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      
      <div
        className={`mb-3 flex h-12 w-12 items-center justify-center rounded-full text-xl ${
          isRecruiter ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"
        }`}
      >
        {isRecruiter ? "👤" : "🧲"}
      </div>
      
      <div className="text-center">
        <h3 className="font-bold text-neutral-900 line-clamp-1" title={node.displayName}>
          {node.displayName}
        </h3>
        {node.code && (
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Código {node.code}
          </p>
        )}
      </div>

      <div className="mt-3 w-full space-y-1 text-center text-[11px] text-neutral-600">
        {node.telefone && <p>{node.telefone}</p>}
        {node.cidade && <p>{node.cidade}</p>}
        <div className="mt-2 flex justify-center gap-3 border-t border-neutral-100 pt-2">
          <div>
            <span className="block font-bold text-neutral-900">{node.directLeadCount + node.directRecruiterCount}</span>
            <span className="text-[10px] uppercase text-neutral-400">Diretos</span>
          </div>
          <div>
            <span className="block font-bold text-neutral-900">{node.totalDescendants}</span>
            <span className="text-[10px] uppercase text-neutral-400">Total</span>
          </div>
        </div>
      </div>

      {node.id > 0 && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDetails(node.id);
          }}
          className="mt-3 w-full rounded-md bg-neutral-100 py-1.5 text-xs font-semibold text-neutral-700 transition hover:bg-neutral-200"
        >
          Ver detalhes
        </button>
      )}

      <Handle type="source" position={Position.Bottom} className="!bg-neutral-400" />
    </div>
  );
}

// Pagination Node Component
function PaginationNode({ data }: NodeProps<{ count: number; onClick: () => void }>) {
  return (
    <div className="flex w-[120px] flex-col items-center justify-center">
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <button
        onClick={(e) => {
          e.stopPropagation();
          data.onClick();
        }}
        className="flex h-12 w-12 items-center justify-center rounded-full border-2 border-dashed border-neutral-300 bg-neutral-50 text-xl font-bold text-neutral-500 transition hover:border-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
        title="Carregar mais"
      >
        +
      </button>
      <span className="mt-2 text-xs font-medium text-neutral-500">
        Mais {data.count}
      </span>
    </div>
  );
}

// Lead Group Node Component
function LeadGroupNode({ data }: NodeProps<{ count: number; onClick: () => void }>) {
  return (
    <div className="flex w-[180px] flex-col items-center rounded-xl border-2 border-sky-100 bg-white p-3 shadow-sm transition hover:shadow-md">
      <Handle type="target" position={Position.Top} className="!bg-neutral-400" />
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-lg text-sky-600">
        👥
      </div>
      <div className="text-center">
        <h3 className="text-sm font-bold text-neutral-900">{data.count} Leads</h3>
        <p className="text-[10px] text-neutral-500">Agrupados</p>
      </div>
      <button
        onClick={(e) => {
          e.stopPropagation();
          data.onClick();
        }}
        className="mt-2 w-full rounded bg-sky-50 py-1 text-[10px] font-semibold text-sky-700 hover:bg-sky-100"
      >
        Ver lista
      </button>
    </div>
  );
}

const nodeTypes = {
  custom: CustomNode,
  pagination: PaginationNode,
  leadGroup: LeadGroupNode,
};

function getLayoutedElements(
  nodes: Node[],
  edges: Edge[],
  direction = "TB"
) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));

  dagreGraph.setGraph({ rankdir: direction });

  nodes.forEach((node) => {
    dagreGraph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    node.position = {
      x: nodeWithPosition.x - NODE_WIDTH / 2,
      y: nodeWithPosition.y - NODE_HEIGHT / 2,
    };
    return node;
  });

  return { nodes: layoutedNodes, edges };
}

function flattenNetwork(
  nodes: NetworkNode[],
  onDetails: (id: number) => void,
  limits: Record<string, number>,
  onLoadMore: (parentId: string) => void,
  onOpenGroup: (leads: NetworkNode[]) => void
): { nodes: Node[]; edges: Edge[] } {
  const resultNodes: Node[] = [];
  const resultEdges: Edge[] = [];

  function traverse(node: NetworkNode, parentId: string | null) {
    const nodeId = node.id.toString();
    
    resultNodes.push({
      id: nodeId,
      type: "custom",
      data: { node, onDetails },
      position: { x: 0, y: 0 },
    });

    if (parentId) {
      resultEdges.push({
        id: `${parentId}-${nodeId}`,
        source: parentId,
        target: nodeId,
        type: "smoothstep",
        animated: true,
        style: { stroke: "#94a3b8" },
      });
    }

    // Separate children
    const recruiters = node.children.filter(c => c.tipo === "recrutador");
    const leads = node.children.filter(c => c.tipo !== "recrutador");

    // Logic for Recruiters: Pagination
    const limit = limits[nodeId] || 10; // Default 10 recruiters shown
    const recruitersToShow = recruiters.slice(0, limit);
    const remainingRecruiters = recruiters.length - limit;

    recruitersToShow.forEach((child) => {
      traverse(child, nodeId);
    });

    if (remainingRecruiters > 0) {
      const paginationId = `${nodeId}-pagination`;
      resultNodes.push({
        id: paginationId,
        type: "pagination",
        data: { count: remainingRecruiters, onClick: () => onLoadMore(nodeId) },
        position: { x: 0, y: 0 },
      });
      resultEdges.push({
        id: `${nodeId}-${paginationId}`,
        source: nodeId,
        target: paginationId,
        type: "smoothstep",
        style: { stroke: "#94a3b8", strokeDasharray: "5 5" },
      });
    }

    // Logic for Leads: Grouping
    if (leads.length > 0) {
      if (leads.length <= 10) {
        // Show normally if few
        leads.forEach((child) => traverse(child, nodeId));
      } else {
        // Group if many
        const groupId = `${nodeId}-leads-group`;
        resultNodes.push({
          id: groupId,
          type: "leadGroup",
          data: { count: leads.length, onClick: () => onOpenGroup(leads) },
          position: { x: 0, y: 0 },
        });
        resultEdges.push({
          id: `${nodeId}-${groupId}`,
          source: nodeId,
          target: groupId,
          type: "smoothstep",
          style: { stroke: "#bae6fd" },
        });
      }
    }
  }

  nodes.forEach((root) => traverse(root, null));

  return { nodes: resultNodes, edges: resultEdges };
}

function NetworkCanvasContent({ roots, trainingOptions, recruiterOptions }: NetworkCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [limits, setLimits] = useState<Record<string, number>>({});
  const [selectedInscricao, setSelectedInscricao] = useState<InscricaoItem | null>(null);
  const [groupLeads, setGroupLeads] = useState<NetworkNode[] | null>(null);

  const handleDetails = useCallback(async (id: number) => {
    try {
      const res = await fetch(`/api/inscricoes/${id}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedInscricao(data.inscricao);
      }
    } catch (error) {
      console.error("Failed to load details", error);
    }
  }, []);

  const handleLoadMore = useCallback((parentId: string) => {
    setLimits((prev) => ({
      ...prev,
      [parentId]: (prev[parentId] || 10) + 10,
    }));
  }, []);

  const handleOpenGroup = useCallback((leads: NetworkNode[]) => {
    setGroupLeads(leads);
  }, []);

  useEffect(() => {
    const { nodes: initialNodes, edges: initialEdges } = flattenNetwork(
      roots,
      handleDetails,
      limits,
      handleLoadMore,
      handleOpenGroup
    );
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [roots, limits, handleDetails, handleLoadMore, handleOpenGroup, setNodes, setEdges]);

  return (
    <div className="relative h-full w-full bg-neutral-50">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        connectionLineType={ConnectionLineType.SmoothStep}
        fitView
        minZoom={0.1}
        maxZoom={1.5}
        defaultEdgeOptions={{ type: 'smoothstep' }}
      >
        <Background color="#e5e7eb" gap={16} size={1} />
        <Controls />
      </ReactFlow>

      {/* Sidebar for Grouped Leads */}
      {groupLeads && (
        <div className="absolute right-0 top-0 h-full w-80 overflow-y-auto border-l border-neutral-200 bg-white p-4 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-bold text-neutral-900">Leads ({groupLeads.length})</h2>
            <button
              onClick={() => setGroupLeads(null)}
              className="rounded-full p-1 text-neutral-500 hover:bg-neutral-100"
            >
              ✕
            </button>
          </div>
          <div className="space-y-3">
            {groupLeads.map((lead) => (
              <div
                key={lead.id}
                className="rounded-lg border border-neutral-100 p-3 shadow-sm transition hover:border-sky-200 hover:shadow-md"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-100 text-sm">🧲</span>
                  <div>
                    <p className="font-semibold text-neutral-900">{lead.displayName}</p>
                    {lead.telefone && <p className="text-xs text-neutral-500">{lead.telefone}</p>}
                  </div>
                </div>
                <button
                  onClick={() => handleDetails(lead.id)}
                  className="mt-2 w-full rounded bg-neutral-50 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  Ver detalhes
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <InscricaoDetails
        inscricao={selectedInscricao}
        onClose={() => setSelectedInscricao(null)}
        onUpdate={(updated) => setSelectedInscricao(updated)}
        trainingOptions={trainingOptions}
        recruiterOptions={recruiterOptions}
      />
    </div>
  );
}

export default function NetworkCanvas(props: NetworkCanvasProps) {
  return (
    <ReactFlowProvider>
      <NetworkCanvasContent {...props} />
    </ReactFlowProvider>
  );
}
