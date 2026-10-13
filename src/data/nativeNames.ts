// Chinese (traditional) names for Earth's Chinese places, shown as a small subscript beside the English name. Keyed by the
// English name; a player's own subscript (state/placeNameStore.ts) wins over these.
export const NATIVE_BY_NAME: Record<string, string> = {
  'Chengyu Megalopolis': '成渝',
  Diaoyucheng: '釣魚城',
  Harbin: '哈爾濱',
  "Xi'an": '西安',
  Kunming: '昆明',
  Lhasa: '拉薩',
  'Taiyuan Launch Centre': '太原衛星發射中心',
  'Jiuquan Cosmodrome': '酒泉衛星發射中心',
}

export const nativeOfName = (name: string | null | undefined): string | undefined => (name ? NATIVE_BY_NAME[name] : undefined)
