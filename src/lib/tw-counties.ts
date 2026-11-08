// 台灣各縣市的大致中心點，用來判斷「家長目前在哪個縣市」，不另外呼叫反向地理編碼。
// 以最近的中心點判斷，在縣市交界附近可能判錯；判錯時最多是多問一次區域或以目前位置搜尋。
// 新竹市／新竹縣、嘉義市／嘉義縣名稱相同，視為同一組。
const CENTERS: { key: string; lat: number; lng: number }[] = [
  { key: '基隆', lat: 25.128, lng: 121.739 },
  { key: '台北', lat: 25.038, lng: 121.564 },
  { key: '新北', lat: 25.012, lng: 121.465 },
  { key: '桃園', lat: 24.994, lng: 121.301 },
  { key: '新竹', lat: 24.804, lng: 120.968 },
  { key: '新竹', lat: 24.839, lng: 121.018 },
  { key: '苗栗', lat: 24.560, lng: 120.821 },
  { key: '台中', lat: 24.148, lng: 120.674 },
  { key: '彰化', lat: 24.075, lng: 120.544 },
  { key: '南投', lat: 23.910, lng: 120.684 },
  { key: '雲林', lat: 23.708, lng: 120.431 },
  { key: '嘉義', lat: 23.480, lng: 120.449 },
  { key: '嘉義', lat: 23.459, lng: 120.333 },
  { key: '台南', lat: 22.999, lng: 120.227 },
  { key: '高雄', lat: 22.627, lng: 120.301 },
  { key: '屏東', lat: 22.672, lng: 120.488 },
  { key: '宜蘭', lat: 24.757, lng: 121.753 },
  { key: '花蓮', lat: 23.977, lng: 121.604 },
  { key: '台東', lat: 22.755, lng: 121.144 },
  { key: '澎湖', lat: 23.566, lng: 119.579 },
  { key: '金門', lat: 24.437, lng: 118.318 },
  { key: '連江', lat: 26.160, lng: 119.951 },
];

export function countyOfPoint(lat: number, lng: number): string {
  let best = CENTERS[0];
  let bestD = Infinity;
  for (const c of CENTERS) {
    const d = (c.lat - lat) ** 2 + ((c.lng - lng) * Math.cos((lat * Math.PI) / 180)) ** 2;
    if (d < bestD) { bestD = d; best = c; }
  }
  return best.key;
}

// 「臺中市」「台中」「花蓮縣」→「台中」「花蓮」；馬祖視為連江
export function countyOfName(name: string): string | null {
  const n = name.trim().replace(/臺/g, '台').replace(/[市縣]$/, '');
  if (n === '馬祖') return '連江';
  return CENTERS.some(c => c.key === n) ? n : null;
}
