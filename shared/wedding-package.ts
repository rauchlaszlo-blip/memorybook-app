// Commercial plan, separate from temporary technical storage safeguards.
export const weddingPackage = {
  id: 'wedding', version: 1, title: 'Esküvői emlékkönyv', currency: 'HUF', pilotAmount: 0,
  perDevice: { photos: 10, videos: 2, videoSeconds: 20, audio: 2, audioSeconds: 20 },
  available: { text: true, photo: true, drawing: true, video: false, audio: false, ai: false, export: false },
  plannedAiArrangements: 2, purchaseHorizonMonths: 12, daysBefore: 10, daysAfter: 7,
  timezone: 'Europe/Budapest', appearance: 'wedding-classic',
} as const;
export function weddingPackageFor(version:number) {
  if(version!==1)throw new Error('Unsupported wedding package version');
  return weddingPackage;
}
