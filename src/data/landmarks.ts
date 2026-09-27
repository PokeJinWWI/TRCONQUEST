// Each nation's landmark government buildings, on its capital
// (scene/keyBuildings.ts). They belong to the capital's key node and are
// captured with it. Flavour: they have no numbers of their own.
//
//   seat      the Government Seat: the capital key node's building
//   others    more landmarks, shown beside the seat
//   fortress  the display name of the capital's starting fortress (gameSetup)

export interface Landmark {
  name: string
  description: string
}

export interface NationLandmarks {
  seat: Landmark
  others: Landmark[]
  fortress: Landmark
}

export const LANDMARKS: Record<string, NationLandmarks> = {
  'imperial-state-of-mars': {
    seat: { name: 'Imperial Palace of Mars', description: 'The Emperor’s residence and the seat of the Imperial government, above Akakyō in Xanthe Terra.' },
    others: [{ name: 'Imperial Diet Building', description: 'Where the Imperial Diet sits: the Empire’s legislature, advising the throne.' }],
    fortress: { name: 'Olympus Castle', description: 'The Empire’s great fortress, guarding the capital.' },
  },
  'republic-of-venus': {
    seat: { name: 'Paphos Senate House', description: 'The seat of the Republic’s government, in Paphos.' },
    others: [{ name: 'Hall of the Cyprian Assembly', description: 'Where the Republic’s elected assembly meets.' }],
    fortress: { name: 'Kythera Citadel', description: 'The Republic’s citadel, guarding the capital.' },
  },
  'orion-republic': {
    seat: { name: 'Grand Assembly of Elysion', description: 'The seat of the Orion Republic’s government: its vast elected assembly, in Elysion.' },
    others: [{ name: 'People’s Forum of Arcadia', description: 'The open forum where citizens petition and debate — the heart of Orion’s democracy.' }],
    fortress: { name: 'Bastion of Tempe', description: 'The Republic’s bastion, guarding the capital.' },
  },
  'kingdom-of-lalande': {
    seat: { name: 'Palais Royal de Bellerive', description: 'The royal palace and seat of the Kingdom’s government, in Bellerive.' },
    others: [{ name: 'Chambre des États', description: 'The chamber of the Kingdom’s estates.' }],
    fortress: { name: 'Château-Fort de Mont-Jérôme', description: 'The Kingdom’s castle, guarding the capital.' },
  },
}
