import { AgentError, supabaseEnv } from "./config";

type MessageSummary = { ID: string };
type Message = {
  Subject: string;
  Date: string;
  To: { Address: string }[];
  Text: string;
};

async function mailpit<T>(pathname: string) {
  const response = await fetch(`${supabaseEnv().mailUrl}/api/v1${pathname}`);
  if (!response.ok)
    throw new AgentError(`Mailpit ${pathname}: ${response.status}`);
  return response.json() as Promise<T>;
}

/** The latest email, optionally to one address, from the local Mailpit. */
export async function latestMail(to?: string) {
  const list = await mailpit<{ messages: MessageSummary[] }>(
    to
      ? `/search?limit=1&query=${encodeURIComponent(`to:"${to}"`)}`
      : "/messages?limit=1",
  );
  const [summary] = list.messages;
  if (!summary) throw new AgentError(to ? `No email to ${to}.` : "No emails.");
  return mailpit<Message>(`/message/${summary.ID}`);
}

/** Unique links in a text body, in order. */
export function extractLinks(text: string) {
  const links = text.match(/https?:\/\/[^\s<>()[\]"']+/g) ?? [];
  return [...new Set(links)];
}

/** Subject, recipient and links: what an agent needs to follow an email. */
export function formatMail(message: Message, { body = false } = {}) {
  const to = message.To.map((recipient) => recipient.Address).join(", ");
  const head = `${message.Subject.trim()} · to ${to} · ${message.Date}`;
  if (body) return `${head}\n\n${message.Text.trim()}`;
  return [head, ...extractLinks(message.Text)].join("\n");
}
