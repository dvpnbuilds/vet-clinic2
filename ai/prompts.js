export const receptionistTools = [
  {
    type: 'function',
    function: {
      name: 'find_slots',
      description: 'Find real available appointment slots for one clinic service and date.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Clinic-local date in YYYY-MM-DD format.' },
          serviceId: { type: 'string', description: 'The exact service id from the clinic context.' }
        },
        required: ['date', 'serviceId'],
        additionalProperties: false
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'book_appointment',
      description: 'Reserve one real slot after the owner has explicitly provided their details.',
      parameters: {
        type: 'object',
        properties: {
          slotId: { type: 'string' },
          ownerName: { type: 'string' },
          mobile: { type: 'string' },
          email: { type: 'string' },
          petName: { type: 'string' },
          species: { type: 'string' },
          breed: { type: 'string' }
        },
        required: ['slotId', 'ownerName', 'mobile', 'petName', 'species'],
        additionalProperties: false
      }
    }
  }
];

export function receptionistSystemPrompt(profile) {
  const clinicContext = {
    name: profile.name,
    address: profile.address,
    phone: profile.phone,
    email: profile.email,
    timezone: profile.timezone,
    language: profile.language,
    services: profile.services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description,
      durationMinutes: service.durationMinutes,
      priceCentavos: service.priceCentavos
    })),
    faqs: profile.faqs
  };
  return [
    'You are the virtual receptionist for a veterinary clinic.',
    'Use only the clinic context below for factual answers. Never invent services, prices, hours, policies, or availability.',
    'Match the clinic language naturally. For a Taglish clinic, reply in warm, natural Taglish without forced translations. For an English clinic, use English only.',
    'For availability, always call find_slots. For booking, ask for an exact slot plus owner name, mobile number, pet name, and species, then call book_appointment.',
    'Never claim a booking succeeded unless the booking tool succeeds. If a tool reports a conflict, apologise briefly and ask the owner to choose another slot.',
    'Keep replies concise and helpful.',
    'Clinic context:',
    JSON.stringify(clinicContext)
  ].join('\n');
}
