/**
 * Módulo acadêmico — aluno, responsável legal e turma.
 *
 * Fronteira que sustenta o desenho (ver docs/plano-substituicao-sponte.md §8):
 * **aluno-na-turma e contrato financeiro são coisas separadas**. A venda fecha o
 * contrato antes de a logística encaixar o aluno num horário, e trocar de turma no
 * meio do contrato é rotina numa escola de curso livre. Juntar os dois obrigaria a
 * cancelar e reemitir contrato a cada troca de horário — que o Financeiro leria como
 * receita perdida.
 */

export type StudentStatus = "ativo" | "inativo" | "trancado" | "concluido";
export type ClassModality = "modular" | "ciclica";
export type ClassStatus = "planejada" | "ativa" | "encerrada";
export type ClassStudentStatus = "ativa" | "trancada" | "cancelada" | "concluida";
export type CalendarDayKind = "feriado" | "recesso" | "letivo_extra";
export type CalendarDayScope = "didatico" | "financeiro" | "ambos";

export interface AcademicGuardian {
  id: number;
  fullName: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  birthDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AcademicGuardianInput {
  fullName: string;
  cpf?: string | null;
  email?: string | null;
  phone?: string | null;
  relationship?: string | null;
  birthDate?: string | null;
  notes?: string | null;
}

/** Turma em que o aluno está alocado, como aparece na ficha dele. */
export interface AcademicStudentClass {
  linkId: number;
  classId: number;
  className: string;
  status: ClassStudentStatus;
  startDate: string | null;
  endDate: string | null;
  financeEnrollmentId: number | null;
}

export interface AcademicStudent {
  id: number;
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  status: StudentStatus;
  guardianId: number | null;
  guardian: AcademicGuardian | null;
  /** Lead de origem em inscricoes.inscricoes. Null = nunca passou pelo funil. */
  leadInscricaoId: number | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  /** Turmas ativas/históricas — vazio significa "aguardando alocação". */
  classes: AcademicStudentClass[];
  /** Contratos financeiros ligados a este aluno (finance_enrollments.student_id). */
  contractsCount: number;
}

export interface AcademicStudentInput {
  fullName: string;
  cpf?: string | null;
  birthDate?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  status?: StudentStatus;
  guardianId?: number | null;
  guardian?: AcademicGuardianInput | null;
  leadInscricaoId?: number | null;
  notes?: string | null;
}

/** Regras de obrigatoriedade editáveis pela secretaria, sem deploy. */
export interface AcademicRegistrationRules {
  studentCpfRequired: boolean;
  studentEmailRequired: boolean;
  studentBirthDateRequired: boolean;
  studentPhoneRequired: boolean;
  guardianRequiredForMinor: boolean;
  guardianCpfRequired: boolean;
  guardianEmailRequired: boolean;
  guardianBirthDateRequired: boolean;
  guardianPhoneRequired: boolean;
}

export interface AcademicStudentFilters {
  search?: string;
  status?: StudentStatus;
  classId?: number;
  /** "sem_turma" = matriculado e ainda não alocado; "sem_lead" = sem origem no funil. */
  flag?: "sem_turma" | "sem_lead" | "menor_sem_responsavel";
}

/**
 * Contrato financeiro que ainda não aponta para um cadastro acadêmico.
 *
 * É uma fila operacional, não um erro de integridade: vendas antigas nasceram antes
 * do módulo acadêmico e vendas novas podem ser fechadas antes de a secretaria
 * completar CPF/e-mail. A tela de Alunos usa esta linha para concluir o vínculo sem
 * depender de UPDATE manual no banco.
 */
export interface AcademicUnlinkedEnrollment {
  id: number;
  studentName: string;
  courseName: string | null;
  saleDate: string;
  leadInscricaoId: number | null;
  leadName: string | null;
  leadPhone: string | null;
}

export interface AcademicRoom {
  id: number;
  name: string;
  capacity: number | null;
  active: boolean;
}

export interface AcademicClassScheduleSlot {
  id: number;
  weekday: number;
  startTime: string;
  endTime: string;
  teacherEmployeeId: number | null;
  teacherName: string | null;
  roomId: number | null;
  roomName: string | null;
}

export interface AcademicClass {
  id: number;
  name: string;
  courseId: number | null;
  courseName: string | null;
  modality: ClassModality;
  level: string | null;
  startDate: string | null;
  endDate: string | null;
  capacity: number | null;
  roomId: number | null;
  roomName: string | null;
  teacherEmployeeId: number | null;
  teacherName: string | null;
  status: ClassStatus;
  /** Ponte opcional com o "treinamento string" de lib/trainings.ts. */
  trainingId: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  schedule: AcademicClassScheduleSlot[];
  /** Alunos com vínculo ativo. */
  activeStudents: number;
  /** Vagas restantes; null quando a turma não tem capacidade definida. */
  seatsLeft: number | null;
  /** Vínculos por situação — trancado e concluído continuam existindo na turma. */
  studentsByStatus: Record<ClassStudentStatus, number>;
  /** Minutos de aula por semana, somados da grade. */
  weeklyMinutes: number;
  /** Ocupação em % das vagas; null quando a turma não tem capacidade definida. */
  occupancy: number | null;
  /**
   * Contratos do Financeiro que apontam para esta turma.
   *
   * Pode ser MAIOR que os alunos alocados: vendeu-se a vaga e o aluno ainda não foi
   * encaixado (ou nem tem ficha). É essa diferença que avisa que a turma vai estourar
   * antes de alguém tentar alocar o excedente.
   */
  linkedContracts: number;
  /** Professores da turma (titular + auxiliares). */
  teachers: AcademicClassTeacher[];
  /** Quadro de aulas: quantas já foram geradas e em qual a turma está. */
  lessonsTotal: number;
  lessonsDone: number;
  /** Próxima aula planejada ("AAAA-MM-DD"). */
  nextLessonDate: string | null;
}

export type ClassTeacherRole = "titular" | "auxiliar";

export interface AcademicClassTeacher {
  employeeId: number;
  name: string;
  role: ClassTeacherRole;
}

export type ClassLessonStatus = "planejada" | "realizada" | "cancelada" | "reposicao";

/** Uma aula com data — o que a grade semanal sozinha não dizia. */
export interface AcademicClassLesson {
  id: number;
  classId: number;
  sequence: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  teacherEmployeeId: number | null;
  teacherName: string | null;
  roomId: number | null;
  roomName: string | null;
  status: ClassLessonStatus;
  topic: string | null;
  notes: string | null;
}

/** Como o aluno esteve na aula. Linha ausente = chamada não lançada. */
export type AttendanceStatus = "presente" | "falta" | "justificada";

/** Uma marcação de chamada: aluno × aula. */
export interface LessonAttendanceMark {
  lessonId: number;
  studentId: number;
  status: AttendanceStatus;
  note: string | null;
  markedBy: string | null;
  markedAt: string;
}

/**
 * Reposição marcada: a aula que o aluno perdeu e onde vai repô-la.
 *
 * `result` é a chamada da aula de destino — `null` enquanto ela não foi
 * lançada. É ele que diz se a falta está de fato reposta.
 */
export interface LessonMakeup {
  id: number;
  studentId: number;
  studentName: string;
  missedLessonId: number;
  missedClassId: number;
  missedClassName: string;
  missedSequence: number;
  missedDate: string;
  makeupLessonId: number;
  makeupClassId: number;
  makeupClassName: string;
  makeupSequence: number;
  makeupDate: string;
  makeupStartTime: string | null;
  result: AttendanceStatus | null;
}

/** Uma aula onde a falta pode ser reposta. */
export interface MakeupOption {
  lessonId: number;
  classId: number;
  className: string;
  sequence: number;
  date: string;
  startTime: string | null;
  endTime: string | null;
  /** Aula extra da própria turma, em vez da mesma aula em turma paralela. */
  sameClass: boolean;
  activeStudents: number;
}

export interface AcademicClassInput {
  name: string;
  courseId?: number | null;
  modality?: ClassModality;
  level?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  capacity?: number | null;
  roomId?: number | null;
  teacherEmployeeId?: number | null;
  status?: ClassStatus;
  trainingId?: string | null;
  notes?: string | null;
  schedule?: AcademicClassScheduleInput[];
  /** Titular + auxiliares. Substitui a lista inteira quando enviado. */
  teachers?: Array<{ employeeId: number; role?: ClassTeacherRole }>;
}

export interface AcademicClassScheduleInput {
  weekday: number;
  startTime: string;
  endTime: string;
  teacherEmployeeId?: number | null;
  roomId?: number | null;
}

/**
 * Uma linha da lista de alunos de uma turma.
 *
 * Traz a ficha resumida junto (contato, documento, responsável) porque quem abre a
 * turma está com o aluno na frente ou no telefone: mandar essa pessoa para `/alunos`
 * só para ver um telefone era o caminho mais rápido de a secretaria voltar a anotar
 * em papel. Os campos financeiros só vêm preenchidos para quem tem `view.finance` —
 * a lista de chamada não é o lugar de vazar contrato (ver `listClassRoster`).
 */
export interface AcademicClassRosterRow {
  linkId: number;
  studentId: number;
  studentName: string;
  status: ClassStudentStatus;
  startDate: string | null;
  endDate: string | null;
  financeEnrollmentId: number | null;
  /** Quando o aluno entrou nesta turma (data do vínculo, não do contrato). */
  linkedAt: string;
  cpf: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  birthDate: string | null;
  studentStatus: StudentStatus;
  guardianName: string | null;
  guardianPhone: string | null;
  leadInscricaoId: number | null;
  notes: string | null;
  /** Outras turmas em que o mesmo aluno está ativo — troca de nível é rotina. */
  otherActiveClasses: Array<{ classId: number; className: string }>;
  /** Contratos do aluno no Financeiro. `null` = sem permissão para ver dinheiro. */
  contractsCount: number | null;
  contractedAmount: number | null;
  paidAmount: number | null;
  /** Situação de pagamento do aluno; `null` = sem permissão para ver dinheiro. */
  payment: AcademicRosterPayment | null;
}

/** Situação de pagamento de um aluno, somando os contratos dele. */
export interface AcademicRosterPayment {
  status: "quitado" | "em_dia" | "atrasado" | "a_conciliar" | "sem_cronograma";
  /** O que falta de verdade: vencido menos o crédito já pago e não aplicado. */
  uncoveredAmount: number;
  creditAmount: number;
  openAmount: number;
  daysLate: number;
}

/**
 * Contagem de alunos por turma para relatório.
 *
 * `awaitingAllocation` é linha própria de propósito: aluno com contrato e sem turma
 * não pode sumir da contagem nem ser somado a uma turma qualquer.
 */
export interface AcademicRosterSummary {
  classes: Array<{ classId: number; className: string; students: number }>;
  /** Tem contrato financeiro, mas ainda não foi encaixado em uma turma ativa. */
  awaitingAllocation: number;
  /** Cadastro ainda sem contrato e sem turma; não pode ser rotulado como matriculado. */
  withoutContractOrClass: number;
  total: number;
}

export interface AcademicCalendarDay {
  day: string;
  kind: CalendarDayKind;
  label: string | null;
  scope: CalendarDayScope;
}

/**
 * Lead pronto para virar aluno: já fechou negócio e ainda não tem ficha.
 *
 * A ficha de aluno nasce depois do "Fechado" — antes disso o lead é oportunidade,
 * não aluno, e nem CPF costuma ter.
 */
export interface AcademicStudentCandidate {
  inscricaoId: number;
  name: string | null;
  phone: string | null;
  email: string | null;
  cpf: string | null;
  /** Etapa atual no funil, para a secretaria conferir de onde ele veio. */
  stageLabel: string | null;
  /** Contrato já registrado no Financeiro à espera de aluno, quando houver. */
  enrollmentId: number | null;
  courseName: string | null;
}

/** Filtros da lista de turmas (todos combináveis). */
export interface AcademicClassFilters {
  status?: ClassStatus;
  search?: string;
  courseId?: number;
  teacherEmployeeId?: number;
  roomId?: number;
  /** 0–6; casa com qualquer horário da grade naquele dia. */
  weekday?: number;
  /** "com_vaga" ignora turma sem capacidade definida (ela nunca lota). */
  seats?: "com_vaga" | "lotada";
}

/**
 * Uma ocorrência de aula projetada a partir da grade + calendário institucional.
 *
 * Feriado e recesso entram na lista com `status` próprio em vez de sumirem: a
 * secretaria precisa ver que a aula de quinta NÃO acontece para avisar a turma —
 * uma data ausente é indistinguível de erro de grade.
 */
export interface AcademicClassSession {
  date: string;
  weekday: number;
  startTime: string;
  endTime: string;
  teacherName: string | null;
  roomName: string | null;
  status: "aula" | "feriado" | "recesso";
  /** Rótulo do dia no calendário ("Aniversário de São Paulo"), quando houver. */
  label: string | null;
}

/** Evento de auditoria da turma (`finance_events`), já pronto para a linha do tempo. */
export interface AcademicClassHistoryEvent {
  id: number;
  entity: "turma" | "turma_aluno";
  action: string;
  label: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: string;
}

/**
 * Turma do aluno vista a partir do CONTRATO — é o que a tela de Matrículas mostra
 * como etiqueta.
 *
 * Duas fontes distintas de propósito: `contractClass` é a turma escrita no contrato
 * (`finance_enrollments.class_id`, o que foi vendido) e `studentClasses` é onde o
 * aluno está de fato alocado hoje. Quando divergem, quem manda na logística é a
 * alocação — e a tela precisa poder mostrar as duas para a divergência aparecer em
 * vez de ser escolhida em silêncio.
 */
export interface EnrollmentClassTag {
  enrollmentId: number;
  studentId: number | null;
  studentName: string | null;
  contractClassId: number | null;
  contractClassName: string | null;
  studentClasses: Array<{
    classId: number;
    className: string;
    status: ClassStudentStatus;
    courseName: string | null;
  }>;
}
