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

const nodeTypes = {
  custom: CustomNode,
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
  maxSiblings: number
): { nodes: Node[]; edges: Edge[] } {
  const resultNodes: Node[] = [];
  const resultEdges: Edge[] = [];

  function traverse(node: NetworkNode, parentId: string | null) {
    const nodeId = node.id.toString();
    
    resultNodes.push({
      id: nodeId,
      type: "custom",
      data: { node, onDetails },
      position: { x: 0, y: 0 }, // Initial position, will be set by dagre
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

    // Limit children
    const childrenToShow = node.children.slice(0, maxSiblings);
    
    childrenToShow.forEach((child) => {
      traverse(child, nodeId);
    });
    
    // If there are more children, we could add a "more" node, but for now let's just limit
  }

  nodes.forEach((root) => traverse(root, null));

  return { nodes: resultNodes, edges: resultEdges };
}

function NetworkCanvasContent({ roots, trainingOptions, recruiterOptions }: NetworkCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [maxSiblings, setMaxSiblings] = useState(5);
  const [selectedInscricao, setSelectedInscricao] = useState<InscricaoItem | null>(null);

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

  useEffect(() => {
    const { nodes: initialNodes, edges: initialEdges } = flattenNetwork(roots, handleDetails, maxSiblings);
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      initialNodes,
      initialEdges
    );
    setNodes(layoutedNodes);
    setEdges(layoutedEdges);
  }, [roots, maxSiblings, handleDetails, setNodes, setEdges]);

  return (
    <div className="h-full w-full bg-neutral-50">
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
        <div className="absolute left-4 top-4 z-10 rounded-lg bg-white p-4 shadow-md">
          <label className="flex flex-col gap-2 text-sm font-medium text-neutral-700">
            Máximo de conexões por linha: {maxSiblings}
            <input
              type="range"
              min="1"
              max="50"
              value={maxSiblings}
              onChange={(e) => setMaxSiblings(Number(e.target.value))}
              className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-neutral-200 accent-neutral-900"
            />
          </label>
          <p className="mt-2 text-xs text-neutral-500">
            Ajuste para melhorar a performance e visualização.
          </p>
        </div>
      </ReactFlow>

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
