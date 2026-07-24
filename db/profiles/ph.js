export default {
  id: 'clinic-pawsitive',
  slug: 'pawsitive-vet-care',
  name: 'Pawsitive Vet Care',
  locale: 'en-PH',
  timezone: 'Asia/Manila',
  currency: 'PHP',
  phone: '+63 917 555 0188',
  email: 'hello@pawsitivevet.example',
  address: 'Quezon City, Metro Manila',
  language: 'taglish',
  access: {
    bookingTitle: 'Mag-book ng visit',
    chatTitle: 'Clinic chat',
    help: 'Ilagay ang demo access code mula sa clinic team para magpatuloy.',
    label: 'Demo access code',
    bookingAction: 'Magpatuloy',
    chatAction: 'Magpatuloy',
    error: 'Hindi ma-access ang demo. Suriin ang code at subukan ulit.',
    staffTitle: 'Staff dashboard',
    staffHelp: 'Ilagay ang staff access code para makita ang live clinic desk.',
    staffLabel: 'Staff access code',
    staffAction: 'Buksan ang dashboard',
    staffError: 'Hindi ma-access ang staff dashboard. Suriin ang code at subukan ulit.'
  },
  booking: {
    kicker: 'Online appointment',
    headline: 'Alaga mo, alaga namin.',
    intro: 'Piliin ang serbisyo at oras na bagay sa inyong schedule. Confirmed ang slot bago kayo pumunta.',
    accessLabel: 'Demo access code',
    accessHelp: 'Ilagay ang code mula sa clinic team para makita ang live na schedule.',
    accessAction: 'Continue',
    serviceHeading: 'Para saan ang visit?',
    serviceHelp: 'Piliin ang service para makita ang available na oras.',
    dateLabel: 'Piliin ang date',
    slotsHeading: 'Available na oras',
    slotsHelp: 'Live ang availability. Ang napiling oras ay ihahanda para sa inyong booking.',
    detailsHeading: 'Ilang detalye lang',
    ownerName: 'Pangalan ninyo',
    mobile: 'Mobile number',
    email: 'Email address (optional)',
    petName: 'Pangalan ng alaga',
    species: 'Uri ng alaga',
    speciesOptions: { dog: 'Aso', cat: 'Pusa', other: 'Iba pa' },
    breed: 'Breed (optional)',
    bookAction: 'I-confirm ang appointment',
    booking: 'Sine-save ang appointment...',
    bookedHeading: 'Booked na ang visit ninyo.',
    bookedBody: 'May reservation na kayo. Makakatanggap kayo ng confirmation at reminder bago ang visit.',
    anotherAction: 'Mag-book ulit',
    unavailable: 'May nag-book na ng oras na iyon. Pumili ng ibang available na slot.',
    slotsEmpty: 'Wala pang available na oras sa date na ito. Subukan ang ibang date.',
    loading: 'Kinukuha ang live na schedule...',
    timeZoneNote: 'Lahat ng oras ay clinic time.',
    required: 'Pakikumpleto ang required fields.',
    accessError: 'Hindi ma-access ang demo. Suriin ang code at subukan ulit.'
  },
  reminders: {
    confirm: {
      subject: 'Paki-confirm ang appointment ni {pet}',
      message: 'Hi {owner}! May {service} si {pet} sa {clinic} sa {appointmentTime}. Confirm: {confirmUrl} Reschedule: {rescheduleUrl}'
    },
    appointment_24h: {
      subject: 'Reminder: appointment ni {pet} bukas',
      message: 'Hi {owner}! Reminder lang: may {service} si {pet} sa {clinic} bukas, {appointmentTime}. Confirm: {confirmUrl} Reschedule: {rescheduleUrl}'
    },
    appointment_2h: {
      subject: 'Appointment ni {pet} in 2 hours',
      message: 'Hi {owner}! 2 hours na lang bago ang {service} ni {pet} sa {clinic}, {appointmentTime}. Confirm: {confirmUrl} Reschedule: {rescheduleUrl}'
    },
    vaccine_due: {
      subject: 'Vaccine reminder para kay {pet}',
      message: 'Hi {owner}! Due na ang {vaccine} vaccine ni {pet}. Mag-book sa {clinic}: {bookingUrl}'
    },
    no_show: {
      subject: 'Missed visit ni {pet}',
      message: 'Hi {owner}! Mukhang na-miss ang visit ni {pet}. Mag-reschedule sa {clinic}: {rescheduleUrl}'
    },
    ownerActions: {
      confirmTitle: 'I-confirm ang appointment',
      rescheduleTitle: 'I-reschedule ang appointment',
      confirmPrompt: 'Pindutin ang continue para i-confirm ang appointment mo.',
      reschedulePrompt: 'Pindutin ang continue para markahan ang appointment para sa rescheduling.',
      continueAction: 'Continue',
      confirmed: 'Confirmed na ang appointment mo.',
      alreadyConfirmed: 'Confirmed na ang appointment mo.',
      rescheduled: 'Nareschedule na ang appointment mo. Makipag-ugnayan sa clinic para pumili ng bagong oras.',
      unavailable: 'Hindi na available ang link na ito.'
    }
  },
  faqs: [
    { question: 'What are your hours?', answer: 'Open kami Monday to Friday, 9 AM to 5 PM, at Saturday, 9 AM to 1 PM.' },
    { question: 'Where are you located?', answer: 'Nasa Quezon City, Metro Manila kami.' },
    { question: 'Do you accept walk-ins?', answer: 'Mas mabilis ang service kapag may appointment. Maaari kang mag-book dito para makapili ng oras.' }
  ],
  chat: {
    title: 'Ask the vet team',
    intro: 'Magtanong tungkol sa clinic o mag-book ng appointment dito.',
    greeting: 'Hi! Ako ang virtual receptionist ng {clinic}. Puwede akong sumagot sa questions at tumulong mag-book ng visit para sa alaga mo.',
    inputLabel: 'Message for the clinic',
    inputPlaceholder: 'Halimbawa: May slot ba bukas para sa anti-rabies?',
    sendAction: 'Send',
    accessError: 'Hindi ma-access ang chat. Suriin ang demo code.',
    unavailable: 'Hindi available ang chat ngayon. Subukan ulit mamaya.'
  },
  dashboard: {
    title: 'Clinic desk',
    intro: 'Live na view ng schedule at follow-ups para sa team.',
    today: 'Schedule ngayon',
    pending: 'Kailangang i-confirm',
    vaccines: 'Vaccines na due',
    recovered: 'Na-recover ng reminders',
    recoveredHelp: 'Confirmed appointments na may na-send na reminder.',
    appointments: 'appointments',
    emptyToday: 'Wala pang appointment ngayon.',
    emptyPending: 'Wala pang pending confirmation.',
    emptyVaccines: 'Wala pang vaccine follow-up na due.',
    demoTitle: 'Staff dashboard',
    demoHelp: 'Ilagay ang demo access code para makita ang live clinic desk.',
    demoAction: 'Open dashboard',
    demoError: 'Hindi ma-access ang dashboard. Suriin ang demo code.',
    loading: 'Kinukuha ang live clinic data...',
    bookingLink: 'Mag-book'
  },
  seed: {
    vet: { id: 'vet-dr-santos', name: 'Dr. Ana Santos', title: 'Veterinarian' },
    owner: { id: 'owner-maria-cruz', name: 'Maria Cruz', mobile: '+639175550001', email: 'maria.cruz@example.test', preferredChannel: 'sms' },
    pet: { id: 'pet-bantay', name: 'Bantay', species: 'dog', breed: 'Aspin' },
    vaccination: { name: '5-in-1', administeredOn: '2025-07-25', dueOn: '2026-07-25' }
  },
  services: [
    { id: 'service-consult', name: 'General Consultation', description: 'Check-up para sa inyong alaga.', durationMinutes: 30, priceCentavos: 65000 },
    { id: 'service-5in1', name: '5-in-1 Vaccination', description: 'Protection against common canine diseases.', durationMinutes: 20, priceCentavos: 90000 },
    { id: 'service-rabies', name: 'Anti-rabies Vaccination', description: 'Annual rabies protection.', durationMinutes: 20, priceCentavos: 55000 },
    { id: 'service-groom', name: 'Basic Grooming', description: 'Bath, nail trim, and ear cleaning.', durationMinutes: 60, priceCentavos: 80000 }
  ],
  hours: [
    { weekday: 1, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 2, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 3, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 4, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 5, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 6, startsAt: '09:00', endsAt: '13:00', capacity: 1 }
  ]
};
