import { NextResponse } from 'next/server';
import { geocodeArea } from '@/lib/places';
import { countyOfName, countyOfPoint } from '@/lib/tw-counties';
import {
  SERVICE_CATEGORIES,
  SERVICE_CATEGORY_KEYS,
  isServiceCategory,
  cleanFeatures,
  cleanFreeQuery,
  buildQuery,
  type ServiceCategoryKey,
} from '@/lib/service-categories';

export const runtime = 'nodejs';

const isLatLng = (v: any): v is { lat: number; lng: number } =>
  v && Number.isFinite(v.lat) && Number.isFinite(v.lng) && Math.abs(v.lat) <= 90 && Math.abs(v.lng) <= 180;


// 伺服器問「哪一區或哪個地標」時固定用這句開頭；家長回答後仍只說縣市，就不再追問，改用較大範圍搜尋
const AREA_QUESTION_MARK = '想以哪一區或哪個地標為中心';

const CATEGORY_GUIDE = SERVICE_CATEGORY_KEYS.map(k => `${k}＝${SERVICE_CATEGORIES[k].label}`).join('、');

const buildSystemPrompt = (petProfile: any, nowText: string) => `你是 Pawink 的寵物照護助理，用繁體中文、溫暖簡短地回覆（2～3 句以內）。
現在時間：${nowText}（台灣）
家長的毛孩檔案：${petProfile?.name || '毛孩'}（${petProfile?.type === 'cat' ? '貓' : '狗'}，${petProfile?.breed || '品種未填'}）；備註：${petProfile?.notes || '無'}
※ 如果家長問的是別的動物（例如檔案是狗，但問貓或兔子），就照他說的動物回答，不要硬套檔案的名字。

你要判斷：直接回答（action=chat），或幫家長在地圖上找店家（action=search）。

【服務類別 category】只能從這些選：${CATEGORY_GUIDE}、other（以上都不是時才用，並在 freeQuery 填 2～6 字的店家類型）。
- 「寄宿、寄放、出國沒人顧、寵物旅館」＝boarding（毛孩單獨住）。
- 「一起住、同房、帶狗去旅行住哪」＝pet_friendly_lodging（人寵同住）。
- 只說「寵物住宿」而分不出是哪一種時，才問一題：「是毛孩自己寄宿，還是要和你一起住？」
- 症狀、受傷、誤食、要打針健檢 → vet；夜間、急診、喘、抽搐、站不穩、中毒 → emergency_vet；兔、鼠、鳥、爬蟲、刺蝟等 → exotic_vet。
- 「寵物公園」若是指讓狗跑的地方 → dog_park（不是連鎖寵物用品店）。
- 兔、鳥、鼠、爬蟲等特殊寵物急症 → exotic_vet，openNow=true，features 放物種名（例如 兔）。
- 撿到走失的狗貓 → vet（可免費掃晶片），並提醒可通報各縣市動保處。
- 寵物計程車、到府美容、到府保母 → other，freeQuery 填「寵物計程車」「到府美容」「寵物保母」。

【什麼時候直接搜尋】
- 只要判斷得出類別就直接 search，不要先問「要不要幫你找」。
- 沒說地區、或說「附近、這裡」→ targetArea 填 null，用家長目前位置搜尋，不要再問地區。
- 說了縣市，就把地名填在 targetArea（例如「花蓮」「台中市西區」「花蓮火車站」）；系統會自己判斷範圍，太大時會再問家長。
- 對話前面已經說過地區（例如花蓮），後面回答「附近、那邊、火車站附近」時，要沿用那個地區組成完整地名（例如「花蓮火車站」），不要改成家長目前位置。
- 家長回答「整個縣市都可以、隨便」時，targetArea 就填那個縣市名。

【健康與緊急】
- 先用 1～2 句說明要注意的危險徵兆或處置（例如誤食巧克力：立刻打給醫院，告知種類與份量），同時 action=search 找醫院，不要只問問題不給醫院。
- 不做診斷、不開藥，提醒以獸醫判斷為準。

【不需要找店家的問題】（飲食常識、保險、訓練觀念、閒聊）→ action=chat，直接給實用的簡短回答。
- 保險：說明比較重點（保費、理賠上限、自負額、等待期、年齡限制），不推薦特定公司。
- 閒聊：輕鬆回應並給一個小建議；最後可以一句話提到你能幫忙找什麼。

【誠實，非常重要】
- 系統只會依類別在 Google 地圖找店，無法篩選評價、醫師耐心、環境、是否關籠、是否收兇狗或特殊飲食。
- replyText 只能說「幫你找 ○○」，不可說「已篩選評價好、細心、環境開闊、不關籠的店」。
- 家長提到特殊條件（不關籠、兇狗、怕吹風、過敏、單獨火化…）時，提醒：「點開店家看評論，或打電話確認」。

【features】只放家長明確要求、而且是店家「服務項目」的詞，最多 2 個（例如：不關籠、24小時、單獨火化、圍欄、剪指甲、貓、兔、爬蟲）。
不可放：評價好、推薦、細心、耐心、溫柔、乾淨等形容詞，也不可放毛孩個性或地名。
【openNow】家長說「現在、還有開、半夜、今晚、急」時為 true。
【追問】一次只問一題；類別清楚就不要追問其他細節。`;

// Gemini 的結構化輸出：強制只回這些欄位，類別只能是清單內的值
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    action: { type: 'STRING', enum: ['chat', 'search'] },
    replyText: { type: 'STRING' },
    category: { type: 'STRING', enum: [...SERVICE_CATEGORY_KEYS, 'other'], nullable: true },
    freeQuery: { type: 'STRING', nullable: true },
    features: { type: 'ARRAY', items: { type: 'STRING' } },
    targetArea: { type: 'STRING', nullable: true },
    openNow: { type: 'BOOLEAN' },
  },
  required: ['action', 'replyText'],
};

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ action: 'chat', reply: '❌ Vercel 尚未設定 GEMINI_API_KEY 環境變數。' });
    }

    // 模型可用環境變數 GEMINI_MODEL 切換；未設定時用 gemini-3.8-flash
    const selectedModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
    const body = await req.json();
    const { prompt, petProfile, history, isEvaluationPhase } = body;
    // 家長目前位置（瀏覽器定位），用來判斷「說了縣市名，但人就在那個縣市」的情況
    const userLoc = isLatLng(body.userLocation) ? body.userLocation : null;

    // 店家評估階段已停用：Google Maps Platform 條款限制以 Google 地圖內容產生新內容
    if (isEvaluationPhase) {
      return NextResponse.json({ error: '店家評估功能已停用' }, { status: 410 });
    }

    const turns: { role: string; content: string }[] = Array.isArray(history) ? history.slice(-12) : [];
    const historyText = turns.length
      ? turns.map(m => `${m.role === 'model' ? 'AI助理' : '家長'}：${m.content}`).join('\n')
      : '無';

    const nowText = new Intl.DateTimeFormat('zh-TW', {
      timeZone: 'Asia/Taipei', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date());

    const finalPrompt = `${buildSystemPrompt(petProfile, nowText)}\n\n【對話紀錄】\n${historyText}\n\n【家長最新訊息】\n${prompt}`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA },
          contents: [{ parts: [{ text: finalPrompt }] }],
        }),
      },
    );
    const genData = await genRes.json();
    if (!genRes.ok) {
      console.error('[api/chat] Gemini 失敗', genData.error?.message);
      return NextResponse.json({ action: 'chat', reply: 'AI 助理暫時無法回應，請稍後再試一次。' });
    }

    let parsed: any;
    try {
      parsed = JSON.parse(genData.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    } catch {
      return NextResponse.json({ action: 'chat', reply: 'AI 思考格式異常，請再試一次。' });
    }

    const reply = typeof parsed.replyText === 'string' && parsed.replyText.trim() ? parsed.replyText.trim() : '可以再多說一點你的需求嗎？';
    if (parsed.action !== 'search') {
      return NextResponse.json({ action: 'chat', reply });
    }

    const category: ServiceCategoryKey | null = isServiceCategory(parsed.category) ? parsed.category : null;
    const targetArea = typeof parsed.targetArea === 'string' && parsed.targetArea.trim() ? parsed.targetArea.trim() : null;
    const features = cleanFeatures(parsed.features);
    const freeQuery = category ? '' : cleanFreeQuery(parsed.freeQuery, targetArea);
    const keyword = buildQuery(category, features, freeQuery);
    if (!keyword) {
      return NextResponse.json({ action: 'chat', reply: '想幫你找店家，可以告訴我是要找哪一類服務嗎？例如動物醫院、美容、寄宿。' });
    }

    const urgent = parsed.openNow === true || category === 'emergency_vet' || (category === 'exotic_vet' && parsed.openNow === true);

    // 沒有說地區、也拿不到家長位置：不要默默用預設的台北搜尋。先給建議，再問在哪裡
    if (!targetArea && !userLoc) {
      // 模型的回覆常寫「這就幫你找」，但這裡還沒辦法找：把這類句子拿掉，只留處置建議
      const advice = urgent
        ? reply.split(/(?<=[，,。！？!?])/).filter((x: string) => !/(尋找|搜尋|找找|查詢|這就|馬上找)/.test(x)).join('').trim().replace(/[，,]$/, '。')
        : '';
      return NextResponse.json({
        action: 'chat',
        reply: `${advice ? advice + '\n\n' : ''}我還不知道你在哪裡。告訴我縣市和區域或附近地標（例如「板橋車站」），${urgent ? '我馬上找最近的醫院' : '我就幫你找'}；也可以在瀏覽器允許定位。`,
      });
    }

    let targetLocation: { lat: number; lng: number } | null = null;
    let scope: 'near' | 'area' | 'broad' = 'near';
    let areaNote: string | null = null;
    if (targetArea) {
      // 地名由 Google 查出真實座標，不採用模型憑記憶給的經緯度
      const resolved = await geocodeArea(targetArea);
      if (!resolved) {
        return NextResponse.json({
          action: 'chat',
          reply: `我在地圖上找不到「${targetArea}」。可以說得更完整一點嗎？例如「花蓮市」「台中市西區」或附近的地標。`,
        });
      }
      // 家長目前所在縣市與詢問的縣市相同才用目前位置（人在台北問「新北」時不能搜台北）
      const askedCounty = countyOfName(targetArea) || countyOfPoint(resolved.lat, resolved.lng);
      if (resolved.broad && userLoc && countyOfPoint(userLoc.lat, userLoc.lng) === askedCounty) {
        // 說了縣市名，而家長就在這個縣市裡：直接以目前位置為中心，不再追問
        targetLocation = { lat: userLoc.lat, lng: userLoc.lng };
        scope = 'area';
        areaNote = `${targetArea}（你目前位置附近）`;
      } else if (resolved.broad) {
        // 縣市範圍太大：先問一次區域或地標；緊急情況或家長已被問過仍只給縣市，就放寬範圍直接搜尋
        const lastModel = [...turns].reverse().find(m => m.role === 'model')?.content || '';
        if (!urgent && !lastModel.includes(AREA_QUESTION_MARK)) {
          return NextResponse.json({
            action: 'chat',
            reply: `${targetArea}範圍很大，${AREA_QUESTION_MARK}呢？例如某個區、車站或景點附近，我會在那附近幫你找。`,
          });
        }
        scope = 'broad';
        targetLocation = { lat: resolved.lat, lng: resolved.lng };
      } else {
        scope = 'area';
        targetLocation = { lat: resolved.lat, lng: resolved.lng };
      }
    }

    const openNow = parsed.openNow === true;
    const label = category ? SERVICE_CATEGORIES[category].label : freeQuery;
    // 特殊寵物的急症：多數夜間急診只看犬貓，提醒先打電話
    const exoticWarning = category === 'exotic_vet' && openNow
      ? '\n\n⚠️ 多數夜間急診只看狗貓，出發前請先打電話確認有看特殊寵物的醫師。'
      : '';
    return NextResponse.json({
      action: 'search',
      reply: reply + exoticWarning,
      keyword,
      // 加了特徵詞卻找太少時，用這個基本詞重搜
      fallbackKeyword: features.length ? buildQuery(category, [], freeQuery) : null,
      features,
      // 醫療相關時手機不要收起對話框，讓處置建議完整顯示
      medical: category === 'vet' || category === 'emergency_vet' || category === 'exotic_vet',
      category,
      openNow,
      targetLocation,
      scope,
      // 讓家長知道系統實際搜尋了什麼
      searchSummary: `${label}｜${areaNote || targetArea || '你附近'}` + (openNow ? '｜營業中（依 Google 營業時間）' : ''),
    });
  } catch (error: any) {
    console.error('[api/chat] 錯誤', error?.message);
    return NextResponse.json({ action: 'chat', reply: '系統暫時出了點問題，請再試一次。' });
  }
}
