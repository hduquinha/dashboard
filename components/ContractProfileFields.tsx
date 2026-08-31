"use client";

import {
  EMPTY_CONTRACT_GUARDIAN,
  profileRequiresGuardian,
  type ContractGuardian,
  type ContractStudentProfile,
} from "@/lib/contractProfile";

/**
 * Quadro do CONTRATANTE (item 2 do contrato), o mesmo em todo lugar que fecha
 * negócio: o modal de venda do CRM e o assistente de "Novo contrato".
 *
 * Compartilhado de propósito. Duas cópias destes campos significariam, mais
 * cedo ou mais tarde, dois conjuntos de regras sobre o que é obrigatório — e
 * contrato gerado por um caminho assinando, pelo outro não.
 */
export function ContractProfileFields({
  profile,
  onChange,
  labelClass,
  inputClass,
}: {
  profile: ContractStudentProfile;
  onChange: (next: ContractStudentProfile) => void;
  labelClass: string;
  inputClass: string;
}) {
  return (
    <>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nome completo do aluno *</label>
          <input
            value={profile.fullName}
            onChange={(event) => onChange({ ...profile, fullName: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>CPF *</label>
          <input
            value={profile.cpf ?? ""}
            onChange={(event) => onChange({ ...profile, cpf: event.target.value })}
            inputMode="numeric"
            placeholder="000.000.000-00"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>RG</label>
          <input
            value={profile.rg ?? ""}
            onChange={(event) => onChange({ ...profile, rg: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Data de nascimento</label>
          <input
            type="date"
            value={profile.birthDate ?? ""}
            onChange={(event) => onChange({ ...profile, birthDate: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Celular *</label>
          <input
            value={profile.phone ?? ""}
            onChange={(event) => onChange({ ...profile, phone: event.target.value })}
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>E-mail *</label>
          <input
            value={profile.email ?? ""}
            onChange={(event) => onChange({ ...profile, email: event.target.value })}
            inputMode="email"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Profissão</label>
          <input
            value={profile.profession ?? ""}
            onChange={(event) => onChange({ ...profile, profession: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Empresa</label>
          <input
            value={profile.company ?? ""}
            onChange={(event) => onChange({ ...profile, company: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Telefone fixo</label>
          <input
            value={profile.landline ?? ""}
            onChange={(event) => onChange({ ...profile, landline: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>CEP *</label>
          <input
            value={profile.zip ?? ""}
            onChange={(event) => onChange({ ...profile, zip: event.target.value })}
            inputMode="numeric"
            className={inputClass}
          />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>Endereço *</label>
          <input
            value={profile.address ?? ""}
            onChange={(event) => onChange({ ...profile, address: event.target.value })}
            placeholder="Rua, número, complemento"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Bairro *</label>
          <input
            value={profile.neighborhood ?? ""}
            onChange={(event) =>
              onChange({ ...profile, neighborhood: event.target.value })
            }
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-[1fr_5rem] gap-2">
          <div>
            <label className={labelClass}>Cidade *</label>
            <input
              value={profile.city ?? ""}
              onChange={(event) => onChange({ ...profile, city: event.target.value })}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>UF *</label>
            <input
              value={profile.state ?? ""}
              maxLength={2}
              onChange={(event) =>
                onChange({ ...profile, state: event.target.value.toUpperCase() })
              }
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <GuardianFields profile={profile} onChange={onChange} labelClass={labelClass} inputClass={inputClass} />
    </>
  );
}

/**
 * Quadro do responsável legal — aparece sozinho quando a data de nascimento diz
 * que o aluno é menor, e some quando ele completa 18.
 *
 * Nasce da data, e não de uma caixinha "é menor de idade": a caixinha envelhece
 * (ninguém volta para desmarcar no aniversário) e deixa passar contrato de menor
 * sem responsável só porque ficou desmarcada. A regra é a mesma que o servidor
 * usa para recusar a emissão — `profileRequiresGuardian`.
 */
function GuardianFields({
  profile,
  onChange,
  labelClass,
  inputClass,
}: {
  profile: ContractStudentProfile;
  onChange: (next: ContractStudentProfile) => void;
  labelClass: string;
  inputClass: string;
}) {
  if (!profileRequiresGuardian(profile)) return null;

  const guardian = profile.guardian ?? EMPTY_CONTRACT_GUARDIAN;
  const setGuardian = (patch: Partial<ContractGuardian>) =>
    onChange({ ...profile, guardian: { ...guardian, ...patch } });

  return (
    <div className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <p className="text-xs font-bold text-amber-900">
        Aluno menor de idade — quem assina é o responsável legal
      </p>
      <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800">
        O contrato fica no nome do aluno, mas quem se obriga (e assina) é o responsável. O link e o código
        de verificação vão para o <strong>e-mail dele</strong>, e é o <strong>CPF dele</strong> que confere na
        hora de assinar.
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className={labelClass}>Nome completo do responsável *</label>
          <input
            value={guardian.fullName}
            onChange={(event) => setGuardian({ fullName: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>CPF do responsável *</label>
          <input
            value={guardian.cpf ?? ""}
            onChange={(event) => setGuardian({ cpf: event.target.value })}
            inputMode="numeric"
            placeholder="000.000.000-00"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Parentesco</label>
          <input
            value={guardian.relationship ?? ""}
            onChange={(event) => setGuardian({ relationship: event.target.value })}
            placeholder="Mãe, pai, avó…"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>E-mail do responsável *</label>
          <input
            value={guardian.email ?? ""}
            onChange={(event) => setGuardian({ email: event.target.value })}
            inputMode="email"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Celular do responsável *</label>
          <input
            value={guardian.phone ?? ""}
            onChange={(event) => setGuardian({ phone: event.target.value })}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Data de nascimento do responsável</label>
          <input
            type="date"
            value={guardian.birthDate ?? ""}
            onChange={(event) => setGuardian({ birthDate: event.target.value })}
            className={inputClass}
          />
        </div>
      </div>
    </div>
  );
}
