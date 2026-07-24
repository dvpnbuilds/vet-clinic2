export default {
  id: 'clinic-harbour',
  slug: 'harbour-veterinary',
  name: 'Harbour Veterinary',
  locale: 'en-AU',
  timezone: 'Australia/Sydney',
  currency: 'AUD',
  phone: '+61 2 5550 0188',
  email: 'hello@harbourvet.example',
  address: 'Surry Hills, Sydney',
  language: 'english',
  access: {
    bookingTitle: 'Book a visit',
    chatTitle: 'Clinic chat',
    help: 'Enter the demo access code from the clinic team to continue.',
    label: 'Demo access code',
    bookingAction: 'Continue',
    chatAction: 'Continue',
    error: 'We could not access the demo. Check the code and try again.',
    staffTitle: 'Staff dashboard',
    staffHelp: 'Enter the staff access code to view the live clinic desk.',
    staffLabel: 'Staff access code',
    staffAction: 'Open dashboard',
    staffError: 'We could not access the staff dashboard. Check the code and try again.'
  },
  booking: {
    kicker: 'Online appointment',
    headline: 'Thoughtful care, right on time.',
    intro: 'Choose a service and a time that suits you. We confirm every appointment before your visit.',
    accessLabel: 'Demo access code',
    accessHelp: 'Enter the code from the clinic team to view live availability.',
    accessAction: 'Continue',
    serviceHeading: 'What can we help with?',
    serviceHelp: 'Choose a service to see available appointment times.',
    dateLabel: 'Choose a date',
    slotsHeading: 'Available times',
    slotsHelp: 'Availability is live. Your selected time will be held while you complete the booking.',
    detailsHeading: 'A few details',
    ownerName: 'Your name',
    mobile: 'Mobile number',
    email: 'Email address (optional)',
    petName: 'Pet name',
    species: 'Pet type',
    speciesOptions: { dog: 'Dog', cat: 'Cat', other: 'Other' },
    breed: 'Breed (optional)',
    bookAction: 'Confirm appointment',
    booking: 'Saving your appointment...',
    bookedHeading: 'Your visit is booked.',
    bookedBody: 'Your reservation is in place. We will send a confirmation and reminder before the visit.',
    anotherAction: 'Book another visit',
    unavailable: 'That time was just booked. Please choose another available time.',
    slotsEmpty: 'There are no available times on this date. Try another date.',
    loading: 'Checking live availability...',
    timeZoneNote: 'All times are shown in clinic time.',
    required: 'Please complete the required fields.',
    accessError: 'We could not access the demo. Check the code and try again.'
  },
  reminders: {
    confirm: {
      subject: 'Please confirm {pet}’s appointment',
      message: 'Hi {owner}, {pet} has a {service} appointment at {clinic} on {appointmentTime}. Confirm: {confirmUrl} Reschedule: {rescheduleUrl}'
    },
    appointment_24h: {
      subject: 'Reminder: {pet}’s appointment tomorrow',
      message: 'Hi {owner}, a reminder that {pet} has a {service} appointment at {clinic} tomorrow, {appointmentTime}. Confirm: {confirmUrl} Reschedule: {rescheduleUrl}'
    },
    appointment_2h: {
      subject: '{pet}’s appointment is in 2 hours',
      message: 'Hi {owner}, {pet} has a {service} appointment at {clinic} in 2 hours, {appointmentTime}. Confirm: {confirmUrl} Reschedule: {rescheduleUrl}'
    },
    vaccine_due: {
      subject: 'Vaccination reminder for {pet}',
      message: 'Hi {owner}, {pet} is due for a {vaccine} vaccination. Book with {clinic}: {bookingUrl}'
    },
    no_show: {
      subject: 'Missed visit for {pet}',
      message: 'Hi {owner}, it looks like {pet} missed a visit. Reschedule with {clinic}: {rescheduleUrl}'
    },
    ownerActions: {
      confirmTitle: 'Confirm your appointment',
      rescheduleTitle: 'Reschedule your appointment',
      confirmPrompt: 'Select continue to confirm your appointment.',
      reschedulePrompt: 'Select continue to mark your appointment for rescheduling.',
      continueAction: 'Continue',
      confirmed: 'Your appointment is confirmed.',
      alreadyConfirmed: 'Your appointment is already confirmed.',
      rescheduled: 'Your appointment has been marked for rescheduling. Please contact the clinic to choose a new time.',
      unavailable: 'This link is no longer available.'
    }
  },
  faqs: [
    { question: 'What are your hours?', answer: 'We are open Monday to Friday, 9 AM to 5 PM.' },
    { question: 'Where are you located?', answer: 'We are located in Surry Hills, Sydney.' },
    { question: 'Do you accept walk-ins?', answer: 'Appointments are recommended so we can reserve the right time for your pet.' }
  ],
  chat: {
    title: 'Ask the vet team',
    intro: 'Ask about the clinic or book an appointment in this chat.',
    greeting: 'Hello! I am the virtual receptionist for {clinic}. I can answer clinic questions and help book a visit for your pet.',
    inputLabel: 'Message for the clinic',
    inputPlaceholder: 'For example: Do you have an anti-rabies appointment tomorrow?',
    sendAction: 'Send',
    accessError: 'We could not access chat. Check the demo code and try again.',
    unavailable: 'Chat is unavailable right now. Please try again shortly.'
  },
  dashboard: {
    title: 'Clinic desk',
    intro: 'A live view of the schedule and follow-ups for the team.',
    today: 'Today’s schedule',
    pending: 'Needs confirmation',
    vaccines: 'Vaccinations due',
    recovered: 'Recovered by reminders',
    recoveredHelp: 'Confirmed appointments with a sent reminder.',
    appointments: 'appointments',
    emptyToday: 'No appointments today.',
    emptyPending: 'No confirmations are pending.',
    emptyVaccines: 'No vaccination follow-ups are due.',
    demoTitle: 'Staff dashboard',
    demoHelp: 'Enter the demo access code to view the live clinic desk.',
    demoAction: 'Open dashboard',
    demoError: 'We could not access the dashboard. Check the demo code.',
    loading: 'Loading live clinic data...',
    bookingLink: 'Booking'
  },
  seed: {
    vet: { id: 'vet-dr-reid', name: 'Dr. Charlotte Reid', title: 'Veterinarian' },
    owner: { id: 'owner-amelia-harris', name: 'Amelia Harris', mobile: '+61412345678', email: 'amelia.harris@example.test', preferredChannel: 'sms' },
    pet: { id: 'pet-scout', name: 'Scout', species: 'dog', breed: 'Australian Kelpie' },
    vaccination: { name: 'C5', administeredOn: '2025-07-25', dueOn: '2026-07-25' }
  },
  services: [
    { id: 'service-consult', name: 'General Consultation', description: 'A check-up for your pet.', durationMinutes: 30, priceCentavos: 8500 },
    { id: 'service-5in1', name: 'Canine Vaccination', description: 'Routine canine vaccination.', durationMinutes: 20, priceCentavos: 11000 },
    { id: 'service-rabies', name: 'Rabies Vaccination', description: 'Rabies protection where required.', durationMinutes: 20, priceCentavos: 7500 },
    { id: 'service-groom', name: 'Basic Grooming', description: 'Bath, nail trim, and ear cleaning.', durationMinutes: 60, priceCentavos: 9500 }
  ],
  hours: [
    { weekday: 1, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 2, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 3, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 4, startsAt: '09:00', endsAt: '17:00', capacity: 1 },
    { weekday: 5, startsAt: '09:00', endsAt: '17:00', capacity: 1 }
  ]
};
