import { randomUUID } from 'node:crypto';
import { bookSlot, listSlots } from '../db/scheduling.js';
import { getActiveClinicProfile } from '../db/profiles/index.js';
import { chatCompletion } from './openrouter.js';
import { receptionistSystemPrompt, receptionistTools } from './prompts.js';

export class ChatError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function cleanMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ChatError('A chat message is required.');
  }
  const cleaned = messages
    .filter((message) => ['user', 'assistant'].includes(message?.role) && typeof message.content === 'string')
    .slice(-20)
    .map((message) => ({ role: message.role, content: message.content.slice(0, 2_000) }));
  if (!cleaned.some((message) => message.role === 'user')) {
    throw new ChatError('A user message is required.');
  }
  return cleaned;
}

async function executeTool(call) {
  const name = call.function?.name;
  let input;
  try {
    input = JSON.parse(call.function?.arguments || '{}');
  } catch {
    return { error: 'Tool arguments were invalid.' };
  }
  if (name === 'find_slots') {
    return { slots: await listSlots({ date: input.date, serviceId: input.serviceId }) };
  }
  if (name === 'book_appointment') {
    return {
      appointment: await bookSlot({
        slotId: input.slotId,
        owner: { name: input.ownerName, mobile: input.mobile, email: input.email },
        pet: { name: input.petName, species: input.species, breed: input.breed }
      }, { idempotencyKey: 'chat:' + (call.id || randomUUID()) })
    };
  }
  return { error: 'Unsupported tool.' };
}

function safeToolResult(result) {
  return JSON.stringify(result);
}

export async function chatWithReceptionist({ messages, complete = chatCompletion }) {
  const profile = getActiveClinicProfile();
  const conversation = [
    { role: 'system', content: receptionistSystemPrompt(profile) },
    ...cleanMessages(messages)
  ];
  const first = await complete({ messages: conversation, tools: receptionistTools });
  const calls = first.tool_calls || [];
  if (!calls.length) {
    return { message: first.content || profile.chat.unavailable, appointment: null };
  }

  const toolResults = [];
  for (const call of calls) {
    try {
      toolResults.push({ call, result: await executeTool(call) });
    } catch (error) {
      toolResults.push({ call, result: { error: error.message, status: error.status || 500 } });
    }
  }
  const followUp = [
    ...conversation,
    { role: 'assistant', content: first.content || '', tool_calls: calls },
    ...toolResults.map(({ call, result }) => ({
      role: 'tool',
      tool_call_id: call.id,
      content: safeToolResult(result)
    }))
  ];
  const final = await complete({ messages: followUp, tools: receptionistTools });
  const appointment = toolResults.find((item) => item.result.appointment)?.result.appointment || null;
  return {
    message: final.content || (appointment ? profile.chat.greeting.replace('{clinic}', profile.name) : profile.chat.unavailable),
    appointment
  };
}
