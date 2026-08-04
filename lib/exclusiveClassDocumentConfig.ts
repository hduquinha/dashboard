/**
 * Opções de agendamento da consultoria na ficha impressa da Aula Exclusiva.
 *
 * Era uma grade de 17 horários fechados (10:00 às 18:00, de meia em meia
 * hora); virou período do dia em 04/08/2026. Quem preenche a ficha está na
 * aula e não sabe a agenda da equipe — marcar "14:30" ali prometia um horário
 * que ninguém tinha conferido. O período é o que a pessoa consegue responder
 * de verdade, e a equipe fecha o horário no contato.
 */
export const CONSULTING_PERIODS = ["Manhã", "Tarde", "Noite"] as const;
