// 寵物檔案的輸入驗證與格式轉換（前端表單 ⇄ 資料庫）。不依賴資料庫，方便單獨測試。

export interface PetProfileInput {
  name: string;
  type: 'dog' | 'cat';
  breed: string;
  birthday: string;        // YYYY-MM-DD 或空字串
  weight: string;          // 例如「10.5 kg」
  notes: string;
  medBrand: string;
  medLastDate: string;     // YYYY-MM-DD 或空字串
  vaccineName: string;
  vaccineLastDate: string; // YYYY-MM-DD 或空字串
}

export interface PetData {
  name: string;
  type: 'DOG' | 'CAT';
  breed: string | null;
  birthday: Date | null;
  weightKg: number | null;
  notes: string | null;
  medBrand: string | null;
  medLastDate: Date | null;
  vaccineName: string | null;
  vaccineLastDate: Date | null;
}

const text = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const date = (v: unknown): Date | null | 'invalid' => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'invalid';
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return 'invalid';
  const year = d.getUTCFullYear();
  return year < 1990 || year > 2100 ? 'invalid' : d;
};

// 驗證表單內容；不合格時回傳錯誤訊息（給使用者看的中文）
export function parsePetInput(body: any): { ok: true; data: PetData } | { ok: false; error: string } {
  const name = text(body?.name, 30);
  if (!name) return { ok: false, error: '請填寫毛孩的名字' };
  if (body?.type !== 'dog' && body?.type !== 'cat') return { ok: false, error: '毛孩類型只能是狗狗或貓咪' };

  const birthday = date(body?.birthday);
  const medLastDate = date(body?.medLastDate);
  const vaccineLastDate = date(body?.vaccineLastDate);
  if (birthday === 'invalid' || medLastDate === 'invalid' || vaccineLastDate === 'invalid') {
    return { ok: false, error: '日期格式不正確' };
  }

  let weightKg: number | null = null;
  const weightText = text(body?.weight, 20);
  if (weightText) {
    const m = weightText.match(/\d+(\.\d+)?/);
    const n = m ? Number(m[0]) : NaN;
    if (!Number.isFinite(n) || n <= 0 || n > 150) return { ok: false, error: '體重請填 0 到 150 公斤之間的數字' };
    weightKg = Math.round(n * 10) / 10;
  }

  return {
    ok: true,
    data: {
      name,
      type: body.type === 'dog' ? 'DOG' : 'CAT',
      breed: text(body?.breed, 30),
      birthday,
      weightKg,
      notes: text(body?.notes, 500),
      medBrand: text(body?.medBrand, 50),
      medLastDate,
      vaccineName: text(body?.vaccineName, 50),
      vaccineLastDate,
    },
  };
}

const ymd = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '');

// 資料庫的寵物（含最近一筆疫苗）轉成前端表單格式
export function toProfile(pet: any): PetProfileInput & { id: string } {
  const vaccine = Array.isArray(pet.vaccines) ? pet.vaccines[0] : null;
  return {
    id: pet.id,
    name: pet.name,
    type: pet.type === 'CAT' ? 'cat' : 'dog',
    breed: pet.breed || '',
    birthday: ymd(pet.birthday),
    weight: typeof pet.weightKg === 'number' ? `${pet.weightKg} kg` : '',
    notes: pet.notes || '',
    medBrand: pet.medBrand || '',
    medLastDate: ymd(pet.medLastDate),
    vaccineName: vaccine?.vaccineName || '',
    vaccineLastDate: ymd(vaccine?.administeredAt),
  };
}

// 疫苗下次補打日：最近一次施打後一年
export function nextVaccineDue(administeredAt: Date): Date {
  const d = new Date(administeredAt);
  d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}
