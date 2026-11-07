import { NextResponse } from 'next/server';
import { geocodeArea, getPlaceDetails, PLACE_ID_PATTERN, type PlaceDetails } from '@/lib/places';
import { verifyChecks } from '@/lib/evidence';

// AI 評估時最多取幾家候選店家的評論（每家一次 Place Details 呼叫，屬最高計費級別）
const MAX_EVAL_CANDIDATES = 5;

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      return NextResponse.json({ reply: "❌ Vercel 尚未設定 GEMINI_API_KEY 環境變數。" });
    }

    const selectedModel = 'gemini-3.7-flash';
    const body = await req.json();
    const { prompt, petProfile, contextStores, history, isEvaluationPhase } = body;

    const historyText = history && history.length > 0 
      ? history.map((m: any) => `${m.role === 'model' ? 'AI助理' : '家長'}：${m.content}`).join('\n')
      : '無';

    let systemPrompt = '';
    let detailsById: Map<string, PlaceDetails> | null = null;
    
    if (!isEvaluationPhase) {
      // 階段 1：需求釐清階段
      systemPrompt = `你現在是 PetHub 的「專業寵物照護助理」。
服務毛孩：${petProfile?.name || '毛孩'} (${petProfile?.type === 'dog' ? '狗狗' : '貓咪'})
品種：${petProfile?.breed || '未填寫'}
特別註記：${petProfile?.notes || '無'}

【任務指令：需求釐清】
家長正在尋找服務。請參考【對話歷史紀錄】，判斷家長的需求是否已經夠明確。
例如找「住宿」時，必須確認：
1. 是毛孩單獨住的寄宿，還是人寵同住的友善飯店？
2. 地點要在附近，還是指定其他縣市？

【極重要規則】
* 若資訊【不足】，請親切提問。⚠️【一次只能問 1 個問題】，絕對不要同時問兩個重點！
* 若資訊【充足】，請將 action 設為 "search"，並給予精準 keyword（例如「台中市西區 寵物友善餐廳」）。
* 【跨區搜尋】：若家長有明確指定「其他縣市/地區」（例如：台中、信義區），請在 targetArea 填入完整地名（例如「台中市西區」、「台北市信義區」），系統會自行查詢座標，你不需要提供經緯度。如果沒指定地區或是說「附近」，targetArea 請設為 null。

請回傳純 JSON 格式：
{
  "action": "chat" 或 "search",
  "replyText": "你的回覆內容（一次只問一個問題）...",
  "keyword": "供 Google Maps 搜尋的關鍵字（若 action 為 search 時才填寫）",
  "targetArea": "台中市西區" 或 null
}`;

    } else {
      // 階段 2：店家評估與推薦階段
      // 取得候選店家的真實資料（Google 評論、店家簡介），交給模型依評論判斷是否符合需求。
      const candidates: any[] = (Array.isArray(contextStores) ? contextStores : [])
        .filter((s: any) => typeof s?.id === 'string' && PLACE_ID_PATTERN.test(s.id))
        .slice(0, MAX_EVAL_CANDIDATES);

      const settled = await Promise.allSettled(candidates.map((s) => getPlaceDetails(s.id)));
      detailsById = new Map();
      settled.forEach((r, i) => {
        if (r.status === 'fulfilled') detailsById!.set(candidates[i].id, r.value);
        else console.error('[api/chat] 店家詳細資料失敗', candidates[i].id, (r.reason as any)?.message);
      });

      const storesForModel = candidates
        .filter((s) => detailsById!.has(s.id))
        .map((s) => {
          const d = detailsById!.get(s.id)!;
          return {
            id: s.id,
            name: s.name,
            address: s.address,
            rating: s.rating ?? null,
            editorialSummary: d.editorialSummary,
            reviews: d.reviews.map((r, idx) => ({ index: idx, rating: r.rating, text: r.text })),
          };
        });

      if (storesForModel.length === 0) {
        return NextResponse.json({
          reply: '抱歉，目前無法取得這些店家的詳細資料，請稍後再試一次。',
          recommendedIds: [],
          evaluations: {},
        });
      }

      systemPrompt = `你現在是 PetHub 的「專業寵物照護助理」。
服務毛孩：${petProfile?.name || '毛孩'} (${petProfile?.type === 'dog' ? '狗狗' : petProfile?.type === 'cat' ? '貓咪' : '毛孩'})
品種：${petProfile?.breed || '未填寫'}
特別註記：${petProfile?.notes || '無'}

【任務指令：依真實評論評估店家】
家長的需求已經確認。以下是周邊店家，附上 Google 上的真實顧客評論與店家簡介：
${JSON.stringify(storesForModel, null, 2)}

步驟：
1. 從【對話歷史紀錄】整理出家長的需求清單 requirements（每項 2 到 8 個字，例如「不關籠」「可攜寵用餐」「接受大型犬」）。家長明確要求的標為 isEssential: true；毛孩檔案的特別註記若和這次服務相關也可以列入（isEssential: false）。最多 4 項。
2. 對每家店、每一項需求，只能根據上面的評論與店家簡介判斷：
   - "met"：有內容明確支持
   - "not_met"：有內容明確顯示不符合
   - "unknown"：評論沒有提到，或說法不明確。沒有證據時一律用 unknown，絕對不要猜測。
   - 判斷為 met 或 not_met 時，quote 必須「逐字複製」評論或簡介中的一段原文（至少 6 個字，不可改寫、不可拼接多句、不可翻譯）。判斷為 unknown 時 quote 填 null。
3. 每家店寫一句 summary（40 字以內），只能根據評論內容，不可加入評論沒有提到的事實。
4. recommendedStoreIds：挑出最適合的最多 3 家。任何一項 isEssential 需求被判為 not_met 的店不可推薦；unknown 可以推薦。
5. replyText 必須極度簡潔，只用一句話說你推薦了畫面上哪幾家；若有需求在評論中查不到，補一句請家長出發前向店家確認。不要列出店家特色、距離或營業時間。

請回傳純 JSON 格式：
{
  "replyText": "...",
  "requirements": [{ "label": "不關籠", "isEssential": true }],
  "stores": [
    {
      "id": "店家ID",
      "summary": "...",
      "checks": [{ "label": "不關籠", "status": "met", "quote": "評論原文片段" }]
    }
  ],
  "recommendedStoreIds": ["店家ID"]
}`;
    }

    const finalPrompt = `${systemPrompt}\n\n【對話歷史紀錄】\n${historyText}\n\n【家長最新訊息】\n${prompt}`;

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
    const genRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        generationConfig: {
          responseMimeType: "application/json",
        },
        contents: [
          {
            parts: [{ text: finalPrompt }],
          },
        ],
      }),
    });

    const genData = await genRes.json();

    if (!genRes.ok) {
      return NextResponse.json({ 
        action: 'chat',
        reply: `❌ 模型 [${selectedModel}] 生成失敗：${genData.error?.message || '未知錯誤'}` 
      });
    }

    const rawText = genData.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    let parsedResult;
    try {
      parsedResult = JSON.parse(rawText);
    } catch (e) {
      // 格式異常時不推薦任何店家，避免把未評估的店當成推薦
      parsedResult = {
        action: 'chat',
        replyText: "AI 思考格式異常，請再試一次。",
        recommendedStoreIds: []
      };
    }

    if (!isEvaluationPhase) {
      // 指定地區時由 Google 查出真實座標，不採用模型憑記憶給的經緯度。
      const targetArea = typeof parsedResult.targetArea === 'string' ? parsedResult.targetArea.trim() : '';
      let targetLocation: { lat: number; lng: number } | null = null;

      if (parsedResult.action === 'search' && targetArea) {
        const resolved = await geocodeArea(targetArea);
        if (!resolved) {
          // 家長明確指定了地區卻查不到位置：不要默默改搜目前位置（會出現錯誤城市的店家），
          // 改成請家長把地區說得更明確。
          return NextResponse.json({
            action: 'chat',
            reply: `抱歉，我在地圖上找不到「${targetArea}」這個地方。可以告訴我更完整的地名嗎？例如「台中市西區」或「高雄市左營區」。`,
            keyword: '',
            targetLocation: null
          });
        }
        targetLocation = { lat: resolved.lat, lng: resolved.lng };
      }

      return NextResponse.json({
        action: parsedResult.action || 'chat',
        reply: parsedResult.replyText,
        keyword: parsedResult.keyword || '',
        targetLocation
      });
    } else {
      // 整理模型的判斷：每一句引文都要在真實評論中找得到，找不到就降為「未確認」
      const requirements: { label: string; isEssential: boolean }[] = (Array.isArray(parsedResult.requirements) ? parsedResult.requirements : [])
        .filter((r: any) => typeof r?.label === 'string' && r.label.trim())
        .slice(0, 4)
        .map((r: any) => ({ label: r.label.trim().slice(0, 16), isEssential: r.isEssential === true }));

      const modelStores: any[] = Array.isArray(parsedResult.stores) ? parsedResult.stores : [];
      const evaluations: Record<string, any> = {};
      detailsById!.forEach((details, id) => {
        const m = modelStores.find((s: any) => s?.id === id) || {};
        evaluations[id] = {
          details,
          summary: typeof m.summary === 'string' && m.summary.trim() ? m.summary.trim().slice(0, 80) : null,
          requirements: verifyChecks(requirements, m.checks, details),
        };
      });

      // 只推薦有資料的候選店家，並排除任何「必要需求」經佐證為不符合的店
      const recommendedIds: string[] = (Array.isArray(parsedResult.recommendedStoreIds) ? parsedResult.recommendedStoreIds : [])
        .filter((id: any) => typeof id === 'string' && evaluations[id])
        .filter((id: string) => !evaluations[id].requirements.some((c: any) => c.isEssential && c.status === 'not_met'))
        .slice(0, 3);

      return NextResponse.json({
        reply: typeof parsedResult.replyText === 'string' && parsedResult.replyText.trim()
          ? parsedResult.replyText
          : 'AI 評估時發生格式異常，請再試一次。',
        recommendedIds,
        evaluations,
      });
    }

  } catch (error: any) {
    return NextResponse.json({ 
      action: 'chat',
      reply: `❌ 伺服器捕捉到異常：${error?.message || '未知錯誤'}` 
    });
  }
}
