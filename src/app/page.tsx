'use client';
import React, { useState, useEffect, useRef } from 'react';
import { useSession, signIn, signOut } from 'next-auth/react';
import { 
  Quote, PawPrint, Sparkles, Send, MapPin, 
  X, Coins, Star, RefreshCcw, Search, ChevronRight,
  Clock, Phone, Navigation, Map, MessageCircle, Globe, ChevronUp, ChevronDown,
  Edit3, Heart, AlertCircle, Pill, Syringe, Activity, ExternalLink, CheckCircle2, XCircle, FileText, LocateFixed, Mic
  , LogIn, LogOut
} from 'lucide-react';
import { SERVICE_CATEGORIES, type ServiceCategoryKey } from '@/lib/service-categories';
import type { GroundingResult } from '@/lib/grounding';
import GroundedAnswer, { GroundingLoading } from '@/components/GroundedAnswer';

interface PetProfile {
  name: string;
  type: 'dog' | 'cat';
  breed: string;
  birthday: string;      
  weight: string;
  notes: string;
  medBrand: string;      
  medLastDate: string;   
  vaccineName: string;   
  vaccineLastDate: string; 
}

interface PlaceReview {
  text: string;
  rating: number | null;
  author: string;
  authorUri: string | null;
  authorPhotoUri: string | null;
  relativeTime: string;
  url: string | null;
  flagUrl: string | null;
  translated: boolean;
}

interface StoreDetails {
  phone: string | null;
  website: string | null;
  googleMapsUri: string | null;
  openNow: boolean | null;
  weekdayHours: string[];
  editorialSummary: string | null;
  reviews: PlaceReview[];
}

interface Store {
  id: string;
  name: string;
  lat: number;
  lng: number;
  rating: number | null;
  reviewsCount: number | null;
  address: string;
  photoUrl: string;
  photoAttributions: { displayName: string; uri: string | null }[];
  detailsToken: string;
  distanceKm?: number;
  distanceText?: string;
  // AI 查證（Google 地圖 Grounding）的回覆有引用這家店
  aiMentioned?: boolean;
  // 點開店家時才向 Google 取得
  details?: StoreDetails;
}

// 快速分類：搜尋詞與 AI 對話共用同一套服務類別（src/lib/service-categories.ts）
const QUICK_FILTERS: { icon: string; label: string; category: ServiceCategoryKey }[] = [
  { icon: '🏥', label: '動物醫院', category: 'vet' },
  { icon: '🏨', label: '寵物寄宿', category: 'boarding' },
  { icon: '✂️', label: '美容洗澡', category: 'grooming' },
  { icon: '☕', label: '友善餐廳', category: 'pet_friendly_dining' },
  { icon: '🕊️', label: '寵物善終', category: 'memorial' },
];

// 卡片取搜尋點附近多遠的店：附近 3 公里；指定區域 5 公里；只給縣市時放寬到 15 公里
const SCOPE_RADIUS_KM = { near: 3, area: 5, broad: 15 } as const;
type SearchScope = keyof typeof SCOPE_RADIUS_KM;
interface SearchOptions { category?: ServiceCategoryKey | null; openNow?: boolean; scope?: SearchScope; fallbackKeyword?: string | null; keepChatOpen?: boolean }

const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; 
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
  return R * c;
};

const calculateAge = (birthday: string) => {
  if (!birthday) return '未知年齡';
  const birthDate = new Date(birthday);
  const today = new Date();
  let ageYears = today.getFullYear() - birthDate.getFullYear();
  let ageMonths = today.getMonth() - birthDate.getMonth();
  
  if (ageMonths < 0 || (ageMonths === 0 && today.getDate() < birthDate.getDate())) {
    ageYears--;
    ageMonths += 12;
  }
  
  if (ageYears < 0) return '尚未出生';
  if (ageYears === 0) return `${ageMonths} 個月`;
  return `${ageYears} 歲${ageMonths > 0 ? ` ${ageMonths} 個月` : ''}`;
};

// 左下角附近店家版位數量（日後的廣告版位）
const FEATURED_SLOT_COUNT = 3;

// 今天（台灣時間）的營業時間。Google 的 weekdayDescriptions 以星期一為第一筆；
// 用台灣時區判斷星期幾，避免使用者裝置在其他時區時顯示成前一天或後一天。
const TW_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const todayHours = (weekdayHours: string[]): string | null => {
  if (weekdayHours.length !== 7) return null;
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Taipei' }).format(new Date());
  const idx = TW_WEEKDAYS.indexOf(day);
  return idx >= 0 ? weekdayHours[idx] : null;
};

// 撥號連結：保留數字與 +，分機符號轉成撥號暫停（逗號）
const telHref = (phone: string) =>
  'tel:' + phone.replace(/(#|ext\.?|分機)/gi, ',').replace(/[^0-9+,]/g, '');

// Google 規定的文字標示：不可翻譯、不可換行、不可改大小寫；字色 #5E5E5E、12–16px、Roboto 400
const GoogleMapsAttribution = () => (
  <span
    translate="no"
    style={{ fontFamily: 'Roboto, Arial, sans-serif', fontWeight: 400, fontSize: 12, color: '#5E5E5E', whiteSpace: 'nowrap' }}
  >
    Google Maps
  </span>
);

// 未登入時，寵物檔案暫存在這台裝置的瀏覽器；登入後會搬進帳號
const GUEST_PET_KEY = 'pawink.guestPet.v1';
const readGuestPet = (): PetProfile | null => {
  try {
    const raw = window.localStorage.getItem(GUEST_PET_KEY);
    return raw ? (JSON.parse(raw) as PetProfile) : null;
  } catch {
    return null;
  }
};
const writeGuestPet = (p: PetProfile | null) => {
  try {
    if (p) window.localStorage.setItem(GUEST_PET_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(GUEST_PET_KEY);
  } catch {
    // 瀏覽器不允許儲存時（例如無痕模式），只在本次瀏覽中保留
  }
};

const PROVIDER_LABEL: Record<string, string> = { line: '使用 LINE 登入', google: '使用 Google 登入' };

export default function FullMapAIPortal() {
  const [coins, setCoins] = useState(2000);
  // 預設收起，避免手機先閃出對話框；桌面版掛載後再展開
  const [isAiBoxMinimized, setIsAiBoxMinimized] = useState(true);
  // 手機搜尋後對話框會收起讓出地圖；把 AI 這次的提醒留在按鈕旁，避免看不到（例如誤食時的處置）
  const [aiPeek, setAiPeek] = useState<string | null>(null);
  const [hasOpenedAi, setHasOpenedAi] = useState(false);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'loading' | 'success' | 'denied' | 'error'>('idle');

  const [isListening, setIsListening] = useState(false);

  const [petProfile, setPetProfile] = useState<PetProfile>({
    name: '來福',
    type: 'dog',
    breed: '柴犬',
    birthday: '2023-04-15',
    weight: '10.5 kg',
    notes: '個性稍緊張抗拒關籠，對雞肉過敏',
    medBrand: '全能狗S',
    medLastDate: '2026-07-16',
    vaccineName: '十合一疫苗',
    vaccineLastDate: '2025-08-20'
  });
  const [isPetModalOpen, setIsPetModalOpen] = useState(false);
  const [tempProfile, setPetTempProfile] = useState<PetProfile>(petProfile);

  // ---- 帳號與寵物檔案存檔 ----
  const { data: session, status: authStatus } = useSession();
  const [petId, setPetId] = useState<string | null>(null);
  const [authProviders, setAuthProviders] = useState<string[]>([]);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  // 避免同一次登入重複搬遷（例如開發模式下 effect 執行兩次）
  const migratingRef = useRef(false);

  useEffect(() => {
    fetch('/api/auth/enabled').then(r => r.json()).then(d => setAuthProviders(d.providers || [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (authStatus === 'unauthenticated') {
      const guest = readGuestPet();
      if (guest) setPetProfile(guest);
      setPetId(null);
    }
    if (authStatus !== 'authenticated') return;

    // 登入後：讀帳號裡的寵物；帳號還沒有寵物、但這台裝置有暫存的，就搬進帳號
    (async () => {
      try {
        const res = await fetch('/api/pets');
        if (!res.ok) throw new Error(String(res.status));
        const { pets } = await res.json();
        const guest = readGuestPet();
        if (pets.length > 0) {
          const { id, ...profile } = pets[0];
          setPetProfile(profile);
          setPetId(id);
          // 帳號裡已經有寵物：這台裝置的暫存不自動合併，保留在裝置上並告知，避免使用者以為被覆蓋
          if (guest && guest.name !== profile.name) {
            showNotice(`已載入帳號裡的「${profile.name}」。這台裝置另外暫存了「${guest.name}」，沒有自動存進帳號。`);
          }
          return;
        }
        if (guest && !migratingRef.current) {
          migratingRef.current = true;
          const created = await fetch('/api/pets', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(guest),
          });
          if (created.ok) {
            const { pet } = await created.json();
            const { id, ...profile } = pet;
            setPetProfile(profile);
            setPetId(id);
            writeGuestPet(null);
            showNotice(`已把「${profile.name}」的檔案存進你的帳號`);
          }
        }
      } catch {
        showNotice('暫時無法讀取帳號裡的寵物檔案');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authStatus]);

  // 儲存寵物檔案：登入時存進帳號，未登入時暫存在這台裝置
  const persistPetProfile = async (profile: PetProfile) => {
    if (authStatus !== 'authenticated') {
      writeGuestPet(profile);
      showNotice(authProviders.length > 0 ? '已暫存在這台裝置。登入後即可存進帳號，換裝置也看得到。' : '已暫存在這台裝置。');
      return;
    }
    try {
      const res = await fetch(petId ? `/api/pets/${petId}` : '/api/pets', {
        method: petId ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        showNotice(data.error || '儲存失敗，請稍後再試');
        return;
      }
      setPetId(data.pet.id);
      showNotice('已存進你的帳號');
    } catch {
      showNotice('儲存失敗，請檢查網路後再試');
    }
  };

  // grounding：AI 查證結果（Google 地圖／網路）。這類訊息只顯示，不送回給我們的 AI 當對話紀錄，
  // 避免把 Google 地圖內容拿去產生新內容（Google Maps Platform 條款 3.2.3(c)）
  const [messages, setMessages] = useState<Array<{ sender: 'ai' | 'user'; text: string; grounding?: GroundingResult | 'loading'; gid?: number }>>([
    { sender: 'ai', text: `嗨！我是 Pawink 毛孩助理 🐾 想幫【${petProfile.name}】找什麼？可以直接說，例如「附近的動物醫院」「下週出國要寄宿」，也可以問照顧上的問題。` }
  ]);
  
  const [inputQuery, setInputQuery] = useState('');
  const [stores, setStores] = useState<Store[]>([]);
  const [displayedStores, setDisplayedStores] = useState<Store[]>([]);
  // 左下角「附近店家」三個版位：開站時依使用者位置顯示最近的三家。
  // 之後要開放給店家刊登廣告時，從這裡換成付費店家（並加上「贊助」標示）。
  const [featuredStores, setFeaturedStores] = useState<Store[]>([]);
  // 上一次搜尋是否因結果太少而拿掉了家長指定的條件
  const lastSearchRelaxedRef = useRef(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isAiTyping, setIsAiTyping] = useState(false); 
  
  const [selectedDetailStore, setSelectedDetailStore] = useState<Store | null>(null);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [expandedReviews, setExpandedReviews] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  // 年齡依「今天」計算，只在瀏覽器端算，避免伺服器預先產生的畫面日期不同造成 React hydration 錯誤
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
    // 手機上 AI 對話框會蓋住下半個畫面，維持收起讓附近店家版位露出；桌面版直接展開
    if (window.innerWidth >= 768) setIsAiBoxMinimized(false);

    // 手機鍵盤：iOS 開鍵盤時版面高度不變、只有可視區變小，要自己算出鍵盤高度，
    // 讓對話框貼在鍵盤上方（Android Chrome 由 viewport 的 interactive-widget 處理）
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;
    let lastKeyboard = 0;
    const syncViewport = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // iOS 開鍵盤時整頁會往上捲 offsetTop，所以要一併扣掉，對話框才會剛好貼在鍵盤上方。
        // Android 有 interactive-widget=resizes-content，innerHeight 會跟著縮，這裡自然算出 0，不會重複抬高。
        let keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        if (keyboard < 4) keyboard = 0; // 網址列伸縮造成的小抖動不算鍵盤
        root.style.setProperty('--kb', `${Math.round(keyboard)}px`);
        root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
        // 鍵盤剛打開：對話區變矮，捲到最新訊息，讓使用者打字時看得到上下文
        if (keyboard > 0 && lastKeyboard === 0) {
          const list = messagesEndRef.current?.parentElement;
          if (list) list.scrollTop = list.scrollHeight;
        }
        lastKeyboard = keyboard;
      });
    };
    // 鍵盤收起後 iOS 有時停在捲動過的位置，強制回到頂端並重新計算
    const onFocusOut = () => {
      setTimeout(() => {
        if (!(document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement)) {
          window.scrollTo(0, 0);
        }
        syncViewport();
      }, 120);
    };
    syncViewport();
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    document.addEventListener('focusout', onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener('resize', syncViewport);
      vv.removeEventListener('scroll', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
      document.removeEventListener('focusout', onFocusOut);
    };
  }, []);

  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNotice = (text: string) => {
    setNotice(text);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  };
  const [isSheetExpanded, setIsSheetExpanded] = useState(false);

  const [lastKeyword, setLastKeyword] = useState('寵物');
  const [lastSearchMode, setLastSearchMode] = useState<'gps' | 'mapCenter'>('gps');
  const [showSearchHereBtn, setShowSearchHereBtn] = useState(false);
  
  const [userLocation, setUserLocation] = useState<{lat: number, lng: number} | null>(null);
  const [hasAutoSearched, setHasAutoSearched] = useState(false);
  
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (window.innerWidth < 768) {
      setIsAiBoxMinimized(true);
    }
  }, []);

  // viewport 設定統一在 layout.tsx（含鍵盤處理的 interactive-widget），這裡不再覆寫

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, isAiTyping]);

  useEffect(() => {
    const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

    const initGoogleMap = () => {
      const google = (window as any).google;
      if (!google || !google.maps || mapRef.current) return;

      const map = new google.maps.Map(document.getElementById('full-map') as HTMLElement, {
        center: { lat: 25.0330, lng: 121.5434 },
        zoom: 15,
        disableDefaultUI: true, 
        zoomControl: false,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        clickableIcons: false,
        styles: [
          { featureType: "poi", stylers: [{ visibility: "off" }] },
          { featureType: "transit", stylers: [{ visibility: "off" }] }
        ]
      });

      mapRef.current = map;

      map.addListener('dragend', () => setShowSearchHereBtn(true));
      map.addListener('zoom_changed', () => setShowSearchHereBtn(true));

      if ('geolocation' in navigator) {
        setLocationStatus('loading');
        navigator.geolocation.getCurrentPosition(
          (position) => {
            setLocationStatus('success');
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            setUserLocation({ lat, lng });

            if (userMarkerRef.current) userMarkerRef.current.setMap(null);
            
            class UserLocationOverlay extends google.maps.OverlayView {
              private position: any;
              private div: HTMLElement | null;

              constructor(pos: any, m: any) {
                super();
                this.position = pos;
                this.div = null;
                this.setMap(m);
              }

              onAdd() {
                this.div = document.createElement('div');
                this.div.style.position = 'absolute';
                this.div.style.transform = 'translate(-50%, -50%)'; 
                this.div.innerHTML = `
                  <div class="relative flex items-center justify-center w-8 h-8 cursor-pointer">
                    <span class="absolute inline-flex w-full h-full rounded-full opacity-60 animate-ping bg-amber-500"></span>
                    <span class="relative inline-flex w-4 h-4 text-white rounded-full bg-[#B88746] border-[2.5px] border-white shadow-[0_0_12px_rgba(184,135,70,0.5)]"></span>
                  </div>
                `;
                const panes = this.getPanes();
                panes.overlayImage.appendChild(this.div);
              }

              draw() {
                const overlayProjection = this.getProjection();
                const pos = overlayProjection.fromLatLngToDivPixel(this.position);
                if (this.div) {
                  this.div.style.left = pos.x + 'px';
                  this.div.style.top = pos.y + 'px';
                }
              }

              onRemove() {
                if (this.div && this.div.parentNode) {
                  this.div.parentNode.removeChild(this.div);
                  this.div = null;
                }
              }
            }

            userMarkerRef.current = new UserLocationOverlay(new google.maps.LatLng(lat, lng), map);
            
            // 🌟 修正點：使用 Google Maps 標準語法進行平移與縮放
            map.panTo({ lat, lng });
            map.setZoom(15);

            searchGooglePlaces('寵物', 'gps', lat, lng, false);
          },
          (error) => {
            setLocationStatus(error.code === error.PERMISSION_DENIED ? 'denied' : 'error');
            searchGooglePlaces('寵物', 'gps', 25.0330, 121.5434, false);
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
        );
      } else {
        setLocationStatus('error');
        searchGooglePlaces('寵物', 'gps', 25.0330, 121.5434, false);
      }
    };

    if ((window as any).google && (window as any).google.maps) {
      initGoogleMap();
    } else {
      const script = document.createElement('script');
      script.id = 'google-maps-js';
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=geometry`;
      script.async = true;
      script.onload = () => initGoogleMap();
      document.body.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (userLocation && !hasAutoSearched) {
      setHasAutoSearched(true);
      searchGooglePlaces('寵物', 'gps', userLocation.lat, userLocation.lng, false);
    }
  }, [userLocation, hasAutoSearched]);

  useEffect(() => {
    const google = (window as any).google;
    if (!google || !google.maps || !mapRef.current) return;

    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    stores.forEach(store => {
      const isSelected = selectedDetailStore?.id === store.id
        || displayedStores.some(ds => ds.id === store.id)
        || (displayedStores.length === 0 && featuredStores.some(fs => fs.id === store.id));
      
      const pinColor = isSelected ? '#E07A5F' : '#B88746';
      const scale = isSelected ? 1.2 : 1.0;
      const width = 36 * scale;
      const height = 44 * scale;

      const innerContent = isSelected 
        ? `<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" fill="#FFFFFF" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M12 2a3 3 0 0 0-3 3v1a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3ZM19 8a2 2 0 0 0-2 2v1a2 2 0 0 0 4 0v-1a2 2 0 0 0-2-2ZM5 8a2 2 0 0 0-2 2v1a2 2 0 0 0 4 0v-1a2 2 0 0 0-2-2ZM12 10a6 6 0 0 0-6 6v3a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-3a6 6 0 0 0-6-6Z" fill="none" stroke="#FFFFFF" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;

      const fullSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 36 44">
          <path d="M18 42 L 11 30 A 14 14 0 1 1 25 30 Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="2.5"/>
          <g transform="translate(6, 4)">
            ${innerContent}
          </g>
        </svg>
      `;

      const markerIcon = {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(fullSvg.trim())}`,
        scaledSize: new google.maps.Size(width, height),
        anchor: new google.maps.Point(width / 2, height)
      };

      const marker = new google.maps.Marker({
        position: { lat: store.lat, lng: store.lng },
        map: mapRef.current,
        icon: markerIcon,
        title: store.name,
        zIndex: isSelected ? 1000 : 1
      });

      marker.addListener('click', () => {
        setDisplayedStores([store]); 
        mapRef.current.panTo({ lat: store.lat, lng: store.lng });
      });

      markersRef.current.push(marker);
    });

    if (displayedStores.length > 0 && !selectedDetailStore && lastSearchMode !== 'mapCenter') {
      if (displayedStores.length === 1) {
        mapRef.current.panTo({ lat: displayedStores[0].lat, lng: displayedStores[0].lng });
      } else {
        const bounds = new google.maps.LatLngBounds();
        displayedStores.forEach(s => bounds.extend({ lat: s.lat, lng: s.lng }));
        mapRef.current.fitBounds(bounds, { bottom: 140, top: 100, left: 20, right: 20 });
      }
    }
  }, [stores, displayedStores, featuredStores, selectedDetailStore, lastSearchMode]);

  // 只有家長用語音提問時才唸出回覆；打字時不出聲，避免在公共場合突然發出聲音
  const voiceReplyRef = useRef(false);
  const speakText = (text: string) => {
    if (!voiceReplyRef.current) return;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const cleanText = text.replace(/[*#]/g, '');
      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.lang = 'zh-TW';
      utterance.rate = 1.05;
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleListening = () => {
    if (isListening) return;

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('抱歉，您的瀏覽器不支援語音辨識功能。建議使用 Chrome 瀏覽器。');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-TW';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel(); 
    };

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInputQuery(transcript);
      voiceReplyRef.current = true;
      handleSendMessage(transcript, true);
    };

    recognition.onerror = (event: any) => {
      console.error('語音辨識錯誤', event.error);
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognition.start();
  };

  const searchGooglePlaces = async (
    keyword: string, 
    searchType: 'gps' | 'mapCenter' = 'gps',
    overrideLat: number | null = null,
    overrideLng: number | null = null,
    showCards: boolean = true,
    opts: SearchOptions = {}
  ) => {
    const scope: SearchScope = opts.scope || 'near';
    const radiusKm = SCOPE_RADIUS_KM[scope];
    setIsLoading(true);
    setShowSearchHereBtn(false);
    setLastKeyword(keyword);
    setLastSearchMode(searchType); 
    setSelectedDetailStore(null); 
    if (window.innerWidth < 768 && showCards && !opts.keepChatOpen) setIsAiBoxMinimized(true);
    lastSearchRelaxedRef.current = false;

    try {
      let searchLat = userLocation?.lat || 25.0330;
      let searchLng = userLocation?.lng || 121.5434;

      if (overrideLat !== null && overrideLng !== null) {
        searchLat = overrideLat;
        searchLng = overrideLng;
      } else if (searchType === 'mapCenter' && mapRef.current) {
        const center = mapRef.current.getCenter();
        searchLat = center.lat(); searchLng = center.lng();
      }

      if (mapRef.current && searchType !== 'mapCenter') {
        mapRef.current.panTo({ lat: searchLat, lng: searchLng });
        mapRef.current.setZoom(scope === 'broad' ? 12 : scope === 'area' ? 14 : 15);
      }

      const params = new URLSearchParams({ keyword, lat: String(searchLat), lng: String(searchLng), radius: String(radiusKm * 1000) });
      if (opts.category) params.set('category', opts.category);
      if (opts.openNow) params.set('openNow', '1');
      if (opts.fallbackKeyword) params.set('fallback', opts.fallbackKeyword);
      const res = await fetch(`/api/places?${params}`);
      if (!res.ok) throw new Error(`店家搜尋失敗（${res.status}）`);

      const data = await res.json();
      lastSearchRelaxedRef.current = data.relaxed === true;
      const defaultImg = petProfile.type === 'dog'
        ? 'https://images.unsplash.com/photo-1548199973-03cce0bbc87b?auto=format&fit=crop&w=600&q=80'
        : 'https://images.unsplash.com/photo-1514888286974-6c03e2ca1dba?auto=format&fit=crop&w=600&q=80';

      // 全部由 Google 的真實資料組成；評論、營業時間等在 AI 評估或點開店家時才補上
      const allFetchedStores: Store[] = (data.results || []).map((place: any) => {
        const lat = place.geometry.location.lat;
        const lng = place.geometry.location.lng;
        const distanceKm = calculateDistance(searchLat, searchLng, lat, lng);
        return {
          id: place.place_id,
          name: place.name || '寵物服務',
          lat, lng,
          rating: typeof place.rating === 'number' ? place.rating : null,
          reviewsCount: typeof place.user_ratings_total === 'number' ? place.user_ratings_total : null,
          address: place.formatted_address || '地址資訊未提供',
          photoUrl: place.photoUrl || defaultImg,
          photoAttributions: Array.isArray(place.photoAttributions) ? place.photoAttributions : [],
          detailsToken: place.detailsToken || '',
          distanceKm,
          distanceText: distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`,
        };
      });

      setStores(allFetchedStores);
      // 卡片：搜尋點 3 公里內的店家依 Google 的相關性排序取前三家；
      // Google 的位置偏好不是硬性範圍，可能混入很遠的店，不足三家時用最近的補上
      const nearby = allFetchedStores.filter(st => (st.distanceKm ?? 0) <= radiusKm);
      const byDistance = [...allFetchedStores].sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
      const cards = [...nearby, ...byDistance.filter(st => !nearby.includes(st))].slice(0, 3);
      setDisplayedStores(showCards ? cards : []);
      // 開站與回到定位點的「寵物」搜尋：用距離最近的三家填滿附近店家版位
      if (!showCards && keyword === '寵物' && searchType === 'gps') {
        setFeaturedStores(byDistance.slice(0, FEATURED_SLOT_COUNT));
      }
      return allFetchedStores;
    } catch (error: any) {
      console.error(error);
      setStores([]);
      setDisplayedStores([]);
      showNotice('店家搜尋暫時無法使用，請稍後再試。');
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async (textToSend?: string, fromVoice = false) => {
    const text = textToSend || inputQuery;
    if (!text.trim()) return;
    voiceReplyRef.current = fromVoice;

    const newHistory = [...messages, { sender: 'user' as const, text }];
    setMessages(newHistory);
    setInputQuery('');
    setIsAiTyping(true);

    try {
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: text,
          petProfile: petProfile,
          userLocation: userLocation || null,
          history: newHistory.slice(1).filter(m => !m.grounding).map(m => ({ 
            role: m.sender === 'ai' ? 'model' : 'user', 
            content: m.text 
          })),
          isEvaluationPhase: false
        })
      });

      const chatData = await chatRes.json();

      if (chatData.action === 'chat') {
        setMessages(prev => [...prev, { sender: 'ai', text: chatData.reply }]);
        speakText(chatData.reply); 
      } else if (chatData.action === 'search') {
        setMessages(prev => [...prev, { sender: 'ai', text: chatData.reply }]);
        if (window.innerWidth < 768) setAiPeek(chatData.reply || null);
        speakText(chatData.reply); 
        
        const finalKeyword = chatData.keyword || text;
        const targetLat = chatData.targetLocation?.lat || null;
        const targetLng = chatData.targetLocation?.lng || null;

        const latestStores = await searchGooglePlaces(finalKeyword, 'gps', targetLat, targetLng, true, {
          category: chatData.category || null,
          openNow: chatData.openNow === true,
          scope: chatData.scope || 'near',
          fallbackKeyword: chatData.fallbackKeyword || null,
          keepChatOpen: chatData.medical === true,
        });

        if (latestStores === null) {
           const errMsg = '抱歉，店家搜尋暫時無法使用，請稍後再試一次。';
           setMessages(prev => [...prev, { sender: 'ai', text: errMsg }]);
           speakText(errMsg);
           setIsAiTyping(false);
           return;
        }

        if (latestStores.length === 0) {
           const noResultMsg = chatData.openNow
             ? '附近暫時找不到「目前營業中」的店家。如果情況緊急，建議直接打給最近的 24 小時動物醫院，或撥 1999 詢問。'
             : '這個地區附近暫時找不到相關的店家，可以換個地點或說得更具體一點。';
           setMessages(prev => [...prev, { sender: 'ai', text: noResultMsg }]);
           speakText(noResultMsg); 
           setIsAiTyping(false);
           return;
        }

        // 不再由 AI 判斷店家是否符合條件（Google 條款限制以地圖內容產生新內容）。
        // 卡片顯示 Google 依關鍵字相關性排序的前三家，點開可看 Google 上的原始資料與評論。
        const wants: string[] = Array.isArray(chatData.features) ? chatData.features : [];
        const wantNote = wants.length === 0 ? ''
          : lastSearchRelaxedRef.current
            ? `\n找不到標明「${wants.join('、')}」的店，先列出這一帶全部的店，請打電話問是否符合。`
            : `\n條件：${wants.join('、')}（店家是否符合，請點開看評論或打電話確認）`;
        const openNote = chatData.openNow === true ? '\n營業狀態來自 Google，實際以店家公告為準，出發前請先打電話。' : '';
        const doneMsg = `🔎 搜尋：${chatData.searchSummary || finalKeyword}${wantNote}${openNote}\n找到 ${latestStores.length} 家，已標在地圖上。點開卡片可看 Google 上的營業時間、電話與評論。`;
        setMessages(prev => [...prev, { sender: 'ai', text: doneMsg }]);

        // AI 查證：店家已標上地圖後，再請 Google 地圖與網路資料補充（約 2 秒，失敗就略過）
        const gLat = targetLat ?? userLocation?.lat ?? null;
        const gLng = targetLng ?? userLocation?.lng ?? null;
        if (chatData.grounding && gLat !== null && gLng !== null) {
          void runGrounding(text, chatData.grounding, gLat, gLng);
        }
      }
    } catch (err) {
      const errorMsg = '請求發生錯誤，後端可能尚未準備好。';
      setMessages(prev => [...prev, { sender: 'ai', text: errorMsg }]);
      speakText(errorMsg);
    } finally {
      setIsAiTyping(false);
    }
  };

  const groundingSeq = useRef(0);
  const runGrounding = async (question: string, g: { need: string; features: string[]; area: string | null }, lat: number, lng: number) => {
    const gid = ++groundingSeq.current;
    setMessages(prev => [...prev, { sender: 'ai', text: '', grounding: 'loading', gid }]);
    let result: GroundingResult | null = null;
    try {
      const res = await fetch('/api/grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, need: g.need, features: g.features, area: g.area, lat, lng }),
      });
      if (res.ok) result = await res.json();
    } catch {}
    const ok = !!result && (!!result.maps || !!result.search);
    setMessages(prev => ok
      ? prev.map(m => (m.gid === gid ? { ...m, grounding: result as GroundingResult } : m))
      : prev.filter(m => m.gid !== gid));
    // 手機版搜尋後對話框會收起：用 AI 按鈕旁的提醒泡泡告訴家長查證好了
    if (ok && window.innerWidth < 768) setAiPeek('🔍 AI 查證好了：Google 地圖評論與網路上的飼主分享，點這裡看');
    // 地圖上：AI 查證有引用到的店加小標記（不刪店、不重排）
    const cited = new Set(result?.maps?.citedPlaceIds || []);
    if (cited.size) {
      const mark = (s: Store) => (cited.has(s.id) ? { ...s, aiMentioned: true } : s);
      setStores(prev => prev.map(mark));
      setDisplayedStores(prev => prev.map(mark));
    }
  };

  const openDetailModal = async (store: Store) => {
    setSelectedDetailStore(store);
    setExpandedReviews(new Set());
    setIsSheetExpanded(false);
    if (window.innerWidth < 768) setIsAiBoxMinimized(true); 
    
    if (mapRef.current) {
      mapRef.current.panTo({ lat: store.lat, lng: store.lng });
    }

    // 還沒有詳細資料（例如從快速分類進來）時，點開才向 Google 取評論與營業時間
    if (!store.details) {
      setIsDetailsLoading(true);
      try {
        const res = await fetch(`/api/place-details?id=${encodeURIComponent(store.id)}&token=${encodeURIComponent(store.detailsToken)}`);
        if (!res.ok) throw new Error(String(res.status));
        const { details } = await res.json();
        const update = (st: Store) => (st.id === store.id ? { ...st, details } : st);
        setStores(prev => prev.map(update));
        setDisplayedStores(prev => prev.map(update));
        setSelectedDetailStore(prev => (prev && prev.id === store.id ? { ...prev, details } : prev));
      } catch {
        showNotice('店家詳細資料暫時無法取得。');
      } finally {
        setIsDetailsLoading(false);
      }
    }
  };

  const handleSavePetProfile = () => {
    setPetProfile(tempProfile);
    setIsPetModalOpen(false);
    persistPetProfile(tempProfile);
    
    let medIntervalDays = 30; 
    let medDesc = "每月投藥的驅蟲預防藥";
    if (tempProfile.medBrand.includes('一錠除') || tempProfile.medBrand.includes('長效')) {
      medIntervalDays = 90;
      medDesc = "每三個月投藥的長效型驅蟲藥";
    }

    const medDate = new Date(tempProfile.medLastDate || new Date().toISOString().split('T')[0]);
    medDate.setDate(medDate.getDate() + medIntervalDays);
    const nextMedStr = `${medDate.getFullYear()}-${String(medDate.getMonth()+1).padStart(2, '0')}-${String(medDate.getDate()).padStart(2, '0')}`;

    const vacDate = new Date(tempProfile.vaccineLastDate || new Date().toISOString().split('T')[0]);
    vacDate.setFullYear(vacDate.getFullYear() + 1);
    const nextVacStr = `${vacDate.getFullYear()}-${String(vacDate.getMonth()+1).padStart(2, '0')}-${String(vacDate.getDate()).padStart(2, '0')}`;

    // 日期已過就提醒逾期，不說「已設定推播」（目前還沒有推播功能）
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dueText = (d: Date, s: string) => (d < today ? `【${s}，已逾期，建議儘快安排】` : `【${s}】`);
    const healthReport = `✨ ${tempProfile.name}的檔案已更新（${calculateAge(tempProfile.birthday)}）\n\n` +
                         `💊 驅蟲：「${tempProfile.medBrand}」(${medDesc})，上次 ${tempProfile.medLastDate}，下次建議 ${dueText(medDate, nextMedStr)}\n\n` +
                         `💉 疫苗：「${tempProfile.vaccineName}」每年補打，下次建議 ${dueText(vacDate, nextVacStr)}\n\n` +
                         `以上日期依你填的資料推算，實際請依獸醫建議。`;

    setMessages(prev => [...prev, { sender: 'ai', text: healthReport }]);
    speakText(`${tempProfile.name}的檔案已更新。`);
    searchGooglePlaces(lastKeyword, 'gps', null, null, false);
    
    if (isAiBoxMinimized) {
      setIsAiBoxMinimized(false);
      setHasOpenedAi(true);
    }
  };

  const handleReturnToLocation = () => {
    const lat = userLocation?.lat || 25.0330;
    const lng = userLocation?.lng || 121.5434;
    if (mapRef.current) {
      mapRef.current.panTo({ lat, lng });
      mapRef.current.setZoom(15);
    }
  };

  const handleNavigate = () => {
    if (selectedDetailStore) {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${selectedDetailStore.lat},${selectedDetailStore.lng}`, '_blank');
    }
  };


  const glassmorphism = "bg-[#FFFDF9]/90 backdrop-blur-2xl ring-1 ring-[#E8DFD8] shadow-[0_8px_30px_rgba(74,66,61,0.06)]";
  const hideScrollbarStyle = `
    .hide-scrollbar::-webkit-scrollbar { display: none; }
    .hide-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
    .card-enter { animation: cardPop 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards; }
    @keyframes cardPop {
      0% { opacity: 0; transform: translateY(20px) scale(0.95); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
  `;

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden font-sans bg-[#FAF6F0] text-[#3D2E24]">
      <style>{hideScrollbarStyle}</style>
      
      {/* 1. 全局地圖 */}
      <div id="full-map" className="absolute inset-0 z-0 h-full w-full"></div>

      {/* 2. 頂部 Header */}
      <header className="absolute top-3 left-3 right-3 md:top-5 md:left-5 md:right-5 z-20 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col md:flex-row md:items-center space-y-3 md:space-y-0 md:space-x-4 shrink-0 md:w-auto">
          
          <div className={`${glassmorphism} px-3 md:px-4 py-2 md:py-2.5 rounded-[22px] flex items-center space-x-2 md:space-x-3 pointer-events-auto self-start border border-[#E8DFD8]`}>
            <div className="w-7 h-7 md:w-9 md:h-9 relative flex items-center justify-center shrink-0">
              <svg viewBox="0 0 100 90" className="w-full h-full text-[#B88746]" fill="none" stroke="currentColor" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M 32 18 C 18 18, 10 32, 10 50 C 10 66, 28 78, 50 86 C 72 78, 90 66, 90 50 C 90 32, 82 18, 68 18 C 56 18, 48 26, 50 36 L 50 36 C 52 26, 46 18, 32 18 Z" strokeWidth="4" />
                <path d="M 22 28 C 16 36, 16 46, 24 50" strokeWidth="3.5" />
                <path d="M 70 34 L 77 24 L 80 37" strokeWidth="3.5" fill="none" />
                <circle cx="34" cy="36" r="2" fill="#B88746" />
                <circle cx="68" cy="42" r="1.8" fill="#B88746" />
                <path d="M 50 64 C 44 56, 36 62, 50 74 C 64 62, 56 56, 50 64 Z" fill="#B88746" stroke="none" />
              </svg>
            </div>
            
            <span className="font-black text-[#38312D] tracking-tight text-lg md:text-xl leading-none whitespace-nowrap">
              Pawink
            </span>
          </div>

          <div className="hidden md:flex items-center space-x-2 overflow-x-auto hide-scrollbar pointer-events-auto w-full md:w-auto">
            {QUICK_FILTERS.map(filter => (
              <button
                key={filter.label}
                onClick={() => searchGooglePlaces(SERVICE_CATEGORIES[filter.category].query, showSearchHereBtn ? 'mapCenter' : 'gps', null, null, true, { category: filter.category })}
                className={`${glassmorphism} flex items-center space-x-2 px-4 py-2.5 rounded-full text-sm font-bold text-[#4A423D] hover:text-[#B88746] hover:bg-[#F7F2EA] transition-all shrink-0`}
              >
                <span className="text-base">{filter.icon}</span>
                <span>{filter.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 右側：寵物生命檔案卡按鈕 */}
        <div className="flex items-center space-x-1.5 md:space-x-2 pointer-events-auto min-w-0">
          <button 
            onClick={() => {
              setPetTempProfile(petProfile);
              setIsPetModalOpen(true);
            }}
            className={`${glassmorphism} hover:bg-[#F7F2EA] transition-all px-3 py-1.5 md:px-4 md:py-2 rounded-full flex items-center space-x-1.5 md:space-x-2 border border-[#E8DFD8] shadow-sm cursor-pointer group min-w-0 whitespace-nowrap relative after:absolute after:-inset-1 after:content-[''] md:after:hidden`}
          >
            <span className="text-lg leading-none">{petProfile.type === 'dog' ? '🐶' : '🐱'}</span>
            <div className="flex flex-col text-left min-w-0 max-w-[96px] md:max-w-none">
              <span className="font-black text-xs md:text-sm text-[#38312D] group-hover:text-[#B88746] leading-none mb-0.5 truncate">
                {petProfile.name}
              </span>
              <span className="text-[10px] text-[#A67C52] font-bold leading-none mt-0.5 truncate">
                {petProfile.breed}{hasMounted ? ` • ${calculateAge(petProfile.birthday)}` : ''}
              </span>
            </div>
            <Edit3 className="hidden md:block w-3.5 h-3.5 text-[#B88746] ml-1 opacity-70 group-hover:opacity-100" />
            <ChevronDown className="md:hidden w-3 h-3 text-[#B88746] shrink-0" aria-hidden="true" />
          </button>

          {/* 帳號：已登入顯示頭像與登出；未登入且已設定登入方式時顯示登入 */}
          {(authStatus === 'authenticated' || authProviders.length > 0) && (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setIsAccountMenuOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={isAccountMenuOpen}
                className={`${glassmorphism} relative rounded-full flex items-center justify-center h-9 md:h-10 after:absolute after:-inset-1 after:content-[''] md:after:hidden ${authStatus === 'authenticated' ? 'w-9 md:w-10 p-0.5' : 'px-3 md:px-3.5 text-xs md:text-sm font-black text-[#4A423D] hover:text-[#B88746] whitespace-nowrap'}`}
              >
                {authStatus === 'authenticated'
                  ? (session?.user?.image
                      ? <img src={session.user.image} alt="我的帳號" referrerPolicy="no-referrer" className="w-full h-full rounded-full object-cover" />
                      : <span className="w-full h-full rounded-full bg-[#F0E8DF] flex items-center justify-center text-sm font-black text-[#B88746]">{(session?.user?.name || '我').slice(0, 1)}</span>)
                  : <><LogIn className="w-4 h-4 mr-1" />登入</>}
              </button>
              {isAccountMenuOpen && (
                <div role="menu" className="absolute right-0 mt-2 w-56 bg-[#FFFDF9] rounded-2xl shadow-xl ring-1 ring-[#E8DFD8] p-2 z-50">
                  {authStatus === 'authenticated' ? (
                    <>
                      <div className="px-3 py-2 text-xs text-[#6E5A4D]">
                        <div className="font-black text-[#38312D] text-sm truncate">{session?.user?.name || '已登入'}</div>
                        {session?.user?.email && <div className="truncate">{session.user.email}</div>}
                      </div>
                      <button type="button" role="menuitem" onClick={() => signOut()} className="w-full flex items-center px-3 py-2.5 rounded-xl text-sm font-bold text-[#4A423D] hover:bg-[#F7F2EA]">
                        <LogOut className="w-4 h-4 mr-2" />登出
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="px-3 py-2 text-xs text-[#6E5A4D]">登入後，毛孩檔案會存進帳號，換裝置也看得到。</p>
                      {authProviders.map(p => (
                        <button
                          key={p}
                          type="button"
                          role="menuitem"
                          onClick={() => signIn(p)}
                          className={`w-full mt-1 px-3 py-2.5 rounded-xl text-sm font-black ${p === 'line' ? 'bg-[#06C755] text-white hover:bg-[#05b34c]' : 'bg-white ring-1 ring-[#E8DFD8] text-[#38312D] hover:bg-[#F7F2EA]'}`}
                        >
                          {PROVIDER_LABEL[p] || p}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div className={`${glassmorphism} hidden md:flex px-4 py-2.5 rounded-full text-sm font-black text-[#B88746] items-center space-x-1.5 bg-[#FFFDF9]`}>
            <Coins className="w-4 h-4 text-[#C59B63]" />
            <span className="hidden md:inline">{coins.toLocaleString()} P</span>
          </div>
        </div>
      </header>

      {/* 手機版快速分類（桌面版在頁首）。右側留空給定位按鈕 */}
      <nav aria-label="快速分類" className="md:hidden absolute top-[64px] left-0 right-16 z-20 pointer-events-auto">
        <div className="flex gap-2 overflow-x-auto hide-scrollbar px-3 py-1">
          {QUICK_FILTERS.map(filter => (
            <button
              key={filter.label}
              type="button"
              onClick={() => searchGooglePlaces(SERVICE_CATEGORIES[filter.category].query, showSearchHereBtn ? 'mapCenter' : 'gps', null, null, true, { category: filter.category })}
              className="shrink-0 flex items-center gap-1 bg-[#FFFDF9]/95 backdrop-blur-xl ring-1 ring-[#E8DFD8] shadow-sm rounded-full px-3 h-9 text-xs font-bold text-[#4A423D] active:scale-95"
            >
              <span aria-hidden="true">{filter.icon}</span>{filter.label}
            </button>
          ))}
        </div>
      </nav>

      {/* 回到我的位置按鈕 */}
      <button 
        onClick={handleReturnToLocation}
        className="absolute top-[80px] right-3 md:top-24 md:right-5 z-20 bg-[#FFFDF9]/90 backdrop-blur-xl shadow-[0_8px_24px_rgba(56,49,45,0.12)] rounded-full p-3 text-[#4A423D] hover:text-[#B88746] transition-all ring-1 ring-[#E8DFD8] active:scale-95"
        title="回到我的位置"
      >
        <LocateFixed className="w-5 h-5 md:w-6 md:h-6" />
      </button>

      {showSearchHereBtn && (
        <div className="absolute top-[108px] md:top-24 left-0 right-0 z-20 flex justify-center pointer-events-none animate-in fade-in slide-in-from-top-4">
          <button 
            onClick={() => searchGooglePlaces(lastKeyword, 'mapCenter', null, null, true)}
            className="bg-[#38312D]/90 backdrop-blur-xl shadow-[0_12px_24px_rgba(56,49,45,0.2)] rounded-full px-5 py-2.5 md:px-6 md:py-3 flex items-center space-x-2 text-white pointer-events-auto hover:bg-[#2A2320] transition-all active:scale-95"
          >
            <RefreshCcw className="w-4 h-4" />
            <span className="text-sm font-bold tracking-wide">搜尋此區域</span>
          </button>
        </div>
      )}

      {/* 💻 電腦與手機共用對話視窗 */}
      {!isAiBoxMinimized && (
        <div className="flex absolute bottom-[var(--kb,0px)] md:bottom-6 md:right-6 w-full md:w-[340px] lg:w-[400px] z-[70] flex-col pointer-events-none animate-in slide-in-from-bottom-10">
          <div className="bg-[#FFFDF9]/95 backdrop-blur-3xl rounded-t-[32px] md:rounded-[32px] shadow-[0_-20px_48px_rgba(56,49,45,0.12)] p-5 md:p-6 flex flex-col h-[55vh] h-[55dvh] max-h-[calc(var(--vvh,100dvh)-16px)] md:h-[560px] md:max-h-[calc(100dvh-184px)] ring-1 ring-[#E8DFD8] pointer-events-auto relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-[#B88746]/10 to-transparent pointer-events-none"></div>
            
            <div className="w-full flex justify-center pb-3 md:hidden" onClick={() => { setIsAiBoxMinimized(true); setHasOpenedAi(true); }}>
               <div className="w-12 h-1.5 bg-[#D8C9BC] rounded-full cursor-pointer"></div>
            </div>

            <button 
              onClick={(e) => { e.stopPropagation(); setIsAiBoxMinimized(true); setHasOpenedAi(true); }} 
              className="absolute top-5 right-5 text-[#A67C52] hover:text-[#38312D] bg-white/60 hover:bg-white shadow-sm p-2 rounded-full z-[100] transition-all cursor-pointer ring-1 ring-black/5"
            >
              <X className="w-5 h-5" />
            </button>
            
            <div className="flex items-center space-x-3.5 mb-4 md:mb-6 relative z-10 shrink-0">
              <div className="w-12 h-12 rounded-[18px] bg-[#B88746] text-white flex items-center justify-center shadow-lg shadow-[#B88746]/25">
                <Sparkles className="w-6 h-6" />
              </div>
              <div>
                <h2 className="font-black text-[#38312D] text-xl tracking-tight">AI 毛孩助理</h2>
                <p className="text-xs text-[#B88746] font-bold mt-0.5">服務對象：{petProfile.name} ({petProfile.breed})</p>
              </div>
            </div>
            
            <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2 pr-3 hide-scrollbar relative z-10">
              {messages.map((m, idx) => (
                <div key={idx} className={`flex ${m.sender === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`p-4 rounded-[20px] max-w-[88%] text-[14px] leading-relaxed shadow-sm ${
                    m.sender === 'user' 
                      ? 'bg-[#B88746] text-white rounded-tr-sm' 
                      : 'bg-white ring-1 ring-[#E8DFD8] text-[#38312D] rounded-tl-sm whitespace-pre-line font-medium'
                  }`}>
                    {m.grounding === 'loading' ? <GroundingLoading /> : m.grounding ? <GroundedAnswer result={m.grounding} /> : m.text}
                  </div>
                </div>
              ))}
              {/* 剛打開時給幾個範例問題，點了就直接送出 */}
              {messages.length === 1 && !isAiTyping && (
                <div className="flex flex-wrap gap-2 pl-1">
                  {['附近的動物醫院', '下週出國，要找寄宿', '附近可以帶狗的餐廳', '狗可以吃葡萄嗎？'].map(q => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => handleSendMessage(q)}
                      className="text-xs font-bold text-[#8A6A3E] bg-[#F7F2EA] hover:bg-[#EFE5D8] ring-1 ring-[#E8DFD8] rounded-full px-3 py-2 active:scale-95"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              )}
              {isAiTyping && (
                <div className="flex justify-start">
                  <div className="p-4 rounded-[20px] max-w-[88%] bg-white ring-1 ring-[#E8DFD8] text-[#38312D] rounded-tl-sm flex items-center space-x-2">
                    <Sparkles className="w-4 h-4 text-[#B88746] animate-pulse" />
                    <span className="text-sm font-medium animate-pulse">Gemini 思考中...</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
            
            <div className="relative z-10 mt-3 md:mt-5 pt-2 border-t border-[#E8DFD8] shrink-0">
              <div className="flex items-center bg-white ring-1 ring-[#E8DFD8] rounded-[24px] p-1.5 focus-within:ring-2 focus-within:ring-[#B88746]/30 transition-all shadow-sm">
                
                <button
                  onClick={toggleListening}
                  className={`p-2.5 rounded-full transition-all flex-shrink-0 ${isListening ? 'bg-rose-100 text-rose-500 animate-pulse' : 'text-[#A67C52] hover:bg-[#F7F2EA]'}`}
                  title="語音輸入"
                >
                  <Mic className="w-5 h-5" />
                </button>

                <input 
                  type="text"
                  value={inputQuery}
                  onChange={(e) => setInputQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                  placeholder={isListening ? "請說話..." : `請輸入想為 ${petProfile.name} 找的服務...`} 
                  className="flex-1 min-w-0 bg-transparent text-base md:text-sm px-2 py-3 outline-none text-[#38312D] placeholder:text-[#A67C52]/60"
                  disabled={isAiTyping || isListening}
                />
                
                <button 
                  onClick={() => handleSendMessage()} 
                  disabled={isAiTyping || isListening}
                  className={`p-3.5 rounded-[20px] shadow-md transition-all ${(isAiTyping || isListening) ? 'bg-[#D8C9BC] cursor-not-allowed' : 'bg-[#B88746] hover:bg-[#A67C52] text-white active:scale-95'}`}
                >
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 喚醒懸浮鈕 */}
      {isAiBoxMinimized && (
        <div className={`absolute z-30 flex flex-col items-end pointer-events-auto transition-all duration-400 ease-out right-4 md:right-6 ${!hasOpenedAi && !aiPeek ? 'animate-bounce' : ''} ${
          (displayedStores.length > 0 || featuredStores.length > 0) && !selectedDetailStore ? 'bottom-[176px] md:bottom-8' : 'bottom-9 md:bottom-8'
        }`}>
          
          {aiPeek && (
            <div className="mb-2 w-[min(280px,calc(100vw-32px))] bg-[#FFFDF9] rounded-2xl shadow-xl ring-1 ring-[#E8DFD8] p-3 pr-8 relative animate-in fade-in">
              <button type="button" onClick={() => { setIsAiBoxMinimized(false); setHasOpenedAi(true); setAiPeek(null); }} className="text-left text-xs leading-relaxed text-[#38312D]">
                <span className="line-clamp-4">{aiPeek}</span>
                <span className="block mt-1 font-bold text-[#B88746]">看完整對話 ›</span>
              </button>
              <button type="button" onClick={() => setAiPeek(null)} aria-label="關閉提醒" className="absolute top-2 right-2 p-1 text-[#A67C52]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {!hasOpenedAi && !aiPeek && (
            <div className="mb-2 mr-2 flex flex-col items-center pointer-events-none">
              <div className="bg-[#E07A5F] text-white text-[13px] font-black px-4 py-2 rounded-2xl shadow-xl flex items-center space-x-1">
                <span>👋 點這裡與 AI 對話！</span>
              </div>
              <div className="w-0 h-0 border-l-[8px] border-l-transparent border-r-[8px] border-r-transparent border-t-[10px] border-t-[#E07A5F]"></div>
            </div>
          )}

          <div className="relative flex items-center justify-center">
            <div className="absolute w-[120%] h-[120%] rounded-full bg-[#B88746]/30 animate-ping"></div>
            
            <button 
              onClick={() => { setIsAiBoxMinimized(false); setHasOpenedAi(true); setAiPeek(null); }} 
              className="relative bg-[#FFFDF9] backdrop-blur-xl shadow-[0_12px_30px_rgba(184,135,70,0.4)] rounded-full p-3 md:pl-5 md:pr-6 md:py-4 flex items-center space-x-3 active:scale-95 transition-all ring-2 ring-[#B88746]/50"
            >
              <div className="w-12 h-12 md:w-12 md:h-12 rounded-full bg-gradient-to-tr from-[#A67C52] to-[#D4AF37] text-white flex items-center justify-center shadow-inner">
                <Sparkles className="w-6 h-6 animate-pulse" />
              </div>
              <span className="hidden md:inline text-base font-black text-[#38312D]">喚醒 AI</span>
            </button>
          </div>
        </div>
      )}

      {/* 底部店家精選卡片 */}
      {displayedStores.length > 0 && !selectedDetailStore && (
        <div className="absolute bottom-7 md:bottom-9 left-0 right-0 z-20 px-4 md:px-6 md:pr-[380px] lg:pr-[440px] flex space-x-4 overflow-x-auto pb-2 snap-x hide-scrollbar pointer-events-auto">
          {displayedStores.map((store, index) => (
            <div 
              key={store.id} 
              onClick={() => openDetailModal(store)}
              className="card-enter w-[85vw] sm:w-[320px] h-[130px] md:h-[150px] flex-shrink-0 snap-center bg-[#FFFDF9]/90 backdrop-blur-2xl rounded-[24px] md:rounded-[32px] shadow-[0_16px_32px_rgba(184,135,70,0.1)] ring-1 ring-[#E8DFD8] overflow-hidden relative flex flex-row cursor-pointer transition-transform hover:-translate-y-1"
              style={{ animationDelay: `${index * 0.1}s` }}
            >
              <button 
                onClick={(e) => { e.stopPropagation(); setDisplayedStores(displayedStores.filter(s => s.id !== store.id)); }} 
                className="absolute top-2 right-2 bg-black/20 hover:bg-black/40 backdrop-blur-md text-white p-1.5 rounded-full transition-colors z-20"
              >
                <X className="w-3.5 h-3.5" />
              </button>

              <div className="relative w-[120px] md:w-[140px] h-full shrink-0">
                <img src={store.photoUrl} alt={store.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent"></div>
                {store.photoAttributions.length > 0 && (
                  <span className="absolute top-1.5 left-1.5 right-1.5 text-[9px] leading-tight text-white/85 truncate drop-shadow">
                    相片：{store.photoAttributions[0].displayName}
                  </span>
                )}
                
                <div className="absolute bottom-2 left-2 right-2 flex flex-col space-y-1">
                   <span className="bg-[#4D8B6F]/90 backdrop-blur-md text-white text-[10px] font-bold px-1.5 py-0.5 rounded-md flex items-center w-max">
                    <Navigation className="w-2.5 h-2.5 mr-0.5" />
                    {store.distanceText}
                  </span>
                  {store.rating !== null && (
                    <div className="bg-white/95 backdrop-blur-sm px-1.5 py-0.5 rounded-lg shadow-sm flex items-center w-max">
                      <Star className="w-3 h-3 text-amber-500 fill-current" />
                      <span className="font-extrabold text-xs text-[#38312D] ml-0.5">{store.rating}</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="p-3 md:p-4 flex flex-col flex-1 relative justify-center overflow-hidden">
                <h3 className="font-black text-[#38312D] text-sm md:text-base leading-tight line-clamp-1 pr-6 mb-1">{store.name}</h3>
                {store.aiMentioned && (
                  <span className="text-[10px] font-bold text-[#4D8B6F] bg-[#EAF3EE] rounded-md px-1.5 py-0.5 w-max" title="AI 依 Google 地圖資訊整理時提到這家；未提到不代表不符合">
                    🔍 AI 查證有提到
                  </span>
                )}
                
                <p className="text-xs text-[#A67C52] flex items-center line-clamp-1 mt-1 font-medium">
                  <MapPin className="w-3 h-3 mr-1 text-[#B88746] shrink-0" />
                  <span className="truncate">{store.address}</span>
                </p>
              </div>
            </div>
          ))}
        </div>
      )}


      {/* 左下角：附近店家版位（日後的廣告版位）。有搜尋結果卡片或店家詳情時讓位 */}
      {featuredStores.length > 0 && displayedStores.length === 0 && !selectedDetailStore && (
        <section
          aria-label="附近店家"
          className="absolute z-20 pointer-events-auto left-0 right-0 bottom-9 md:right-auto md:left-6 md:bottom-10 md:w-[280px] lg:w-[340px]"
        >
          <h2 className="px-4 md:px-1 mb-2 text-xs font-black text-[#4A423D] tracking-wide flex items-center">
            <span className="bg-[#FFFDF9]/90 backdrop-blur-xl rounded-full px-3 py-1 ring-1 ring-[#E8DFD8] shadow-sm flex items-center">
              <MapPin className="w-3.5 h-3.5 mr-1 text-[#B88746]" aria-hidden="true" />
              離你最近的寵物店家
            </span>
            <span className="ml-2 bg-[#FFFDF9]/90 rounded-full px-2 py-0.5 ring-1 ring-[#E8DFD8]"><GoogleMapsAttribution /></span>
          </h2>
          <ul className="flex md:flex-col gap-3 overflow-x-auto md:overflow-visible snap-x snap-mandatory touch-pan-x md:touch-auto hide-scrollbar px-4 md:px-0 pb-1">
            {featuredStores.map((store, index) => (
              <li
                key={store.id}
                data-slot={index + 1}
                className="card-enter relative w-[78vw] max-w-[320px] md:w-full md:max-w-none h-[104px] md:h-[96px] shrink-0 snap-center bg-[#FFFDF9]/92 backdrop-blur-2xl rounded-[22px] shadow-[0_12px_28px_rgba(184,135,70,0.12)] ring-1 ring-[#E8DFD8] overflow-hidden flex transition-transform hover:-translate-y-0.5 focus-within:ring-2 focus-within:ring-[#B88746]"
                style={{ animationDelay: `${index * 0.08}s` }}
              >
                <div className="relative w-[96px] h-full shrink-0">
                  <img src={store.photoUrl} alt="" className="w-full h-full object-cover" />
                  {store.photoAttributions.length > 0 && (
                    <span className="absolute top-1 left-1 right-1 z-10 text-[8px] leading-tight text-white/90 truncate drop-shadow">
                      相片：
                      {store.photoAttributions[0].uri ? (
                        <a href={store.photoAttributions[0].uri} target="_blank" rel="noopener noreferrer" className="underline">
                          {store.photoAttributions[0].displayName}
                        </a>
                      ) : store.photoAttributions[0].displayName}
                    </span>
                  )}
                </div>
                <div className="p-3 flex flex-col justify-center min-w-0 flex-1">
                  <h3 className="font-black text-[#38312D] text-sm leading-tight truncate">
                    {/* 整張卡片可點：按鈕的 ::after 蓋滿卡片，相片作者連結疊在上層仍可點 */}
                    <button
                      type="button"
                      onClick={() => openDetailModal(store)}
                      className="text-left truncate max-w-full focus:outline-none after:absolute after:inset-0 after:content-['']"
                    >
                      {store.name}
                    </button>
                  </h3>
                  <div className="flex items-center mt-1.5 space-x-2 text-[11px] font-bold">
                    <span className="text-[#4D8B6F] flex items-center">
                      <Navigation className="w-3 h-3 mr-0.5" aria-hidden="true" />
                      <span className="sr-only">距離</span>{store.distanceText}
                    </span>
                    {store.rating !== null && (
                      <span className="text-[#38312D] flex items-center" aria-label={`Google 評分 ${store.rating} 顆星`}>
                        <Star className="w-3 h-3 text-amber-500 fill-current mr-0.5" aria-hidden="true" />
                        <span aria-hidden="true">{store.rating}</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#A67C52] truncate mt-1">{store.address}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* 店家詳情 Bottom Sheet */}
      {selectedDetailStore && (
        <div className={`absolute z-[60] bg-[#FFFDF9]/95 backdrop-blur-3xl shadow-[0_-10px_40px_rgba(56,49,45,0.15)] flex flex-col pointer-events-auto transition-all duration-400 ease-out
                        md:top-0 md:bottom-0 md:left-0 md:w-[440px] md:h-full md:rounded-none md:ring-1 md:ring-[#E8DFD8]
                        top-auto bottom-0 left-0 w-full rounded-t-[32px] overflow-hidden
                        ${isSheetExpanded ? 'h-[85vh] h-[85dvh]' : 'h-[344px] max-h-[60dvh]'} md:h-full md:max-h-none`}>
          
          <div 
            onClick={() => setIsSheetExpanded(!isSheetExpanded)}
            className="w-full py-2.5 flex flex-col items-center justify-center cursor-pointer bg-[#F7F2EA]/60 hover:bg-[#F7F2EA] transition-colors md:hidden shrink-0 border-b border-[#E8DFD8]"
          >
            <div className="w-12 h-1.5 bg-[#D8C9BC] rounded-full"></div>
            <div className="flex items-center text-[10px] text-[#A67C52] font-bold mt-1">
              {isSheetExpanded ? <ChevronDown className="w-3 h-3 mr-0.5" /> : <ChevronUp className="w-3 h-3 mr-0.5" />}
              <span>{isSheetExpanded ? '下滑縮小看雙針地圖' : '向上展開看營業時間與評論'}</span>
            </div>
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <div className={`relative ${isSheetExpanded ? 'h-[140px]' : 'h-[104px]'} md:h-64 max-md:landscape:h-[76px] w-full shrink-0`}>
              <img src={selectedDetailStore.photoUrl} alt={selectedDetailStore.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"></div>
              {selectedDetailStore.photoAttributions.length > 0 && (
                <div className="absolute top-3.5 left-4 right-16 text-[10px] text-white/80 font-medium truncate">
                  相片：{selectedDetailStore.photoAttributions.map((a, i) => (
                    <React.Fragment key={i}>
                      {i > 0 && '、'}
                      {a.uri
                        ? <a href={a.uri} target="_blank" rel="noopener noreferrer" className="underline">{a.displayName}</a>
                        : a.displayName}
                    </React.Fragment>
                  ))}
                </div>
              )}
              
              <button 
                onClick={(e) => { e.stopPropagation(); setSelectedDetailStore(null); }} 
                className="absolute top-3.5 right-3.5 bg-white/20 hover:bg-white/40 backdrop-blur-lg text-white p-2 rounded-full transition-colors z-[100] cursor-pointer ring-1 ring-white/30"
              >
                <X className="w-4 h-4 md:w-5 md:h-5" />
              </button>
              
              <div className="absolute bottom-3 left-5 right-5">
                <div className="flex items-center space-x-2 mb-1">
                  <span className="bg-[#4D8B6F]/90 backdrop-blur-md text-white text-[10px] font-bold px-2 py-0.5 rounded-lg flex items-center shadow-sm">
                    <Navigation className="w-2.5 h-2.5 mr-0.5" />
                    距離 {selectedDetailStore.distanceText}
                  </span>
                  {selectedDetailStore.rating !== null && (
                    <div className="flex items-center text-amber-400 bg-black/30 backdrop-blur-md px-2 py-0.5 rounded-lg ring-1 ring-white/20">
                      <Star className="w-3.5 h-3.5 fill-current" />
                      <span className="text-xs font-extrabold ml-1 text-white">{selectedDetailStore.rating}</span>
                      {selectedDetailStore.reviewsCount !== null && (
                        <span className="text-[10px] ml-1 text-white/70">({selectedDetailStore.reviewsCount})</span>
                      )}
                    </div>
                  )}
                </div>
                <h2 className="text-white text-lg md:text-2xl font-black leading-tight shadow-sm truncate">{selectedDetailStore.name}</h2>
              </div>
            </div>

            <div className={`flex-1 min-h-0 ${isSheetExpanded ? 'overflow-y-auto' : 'overflow-hidden md:overflow-y-auto'} hide-scrollbar pb-6 pt-1`} onClick={(e) => { if (!isSheetExpanded && window.innerWidth < 768 && !(e.target as HTMLElement).closest('a, button')) setIsSheetExpanded(true); }}>
              <div className="px-5 py-3 flex flex-col space-y-2 border-b border-[#E8DFD8]">
                <div className="flex items-start text-xs md:text-sm text-[#4A423D] font-medium">
                  <MapPin className="w-4 h-4 mr-2.5 text-[#B88746] mt-0.5 shrink-0" />
                  <span className="leading-relaxed">{selectedDetailStore.address}</span>
                </div>
                <div className="flex justify-end -mt-1">
                  <GoogleMapsAttribution />
                </div>
                {isDetailsLoading && !selectedDetailStore.details && (
                  <div className="text-xs text-[#A67C52] font-medium pl-6">正在讀取營業時間與 Google 評論…</div>
                )}
                {selectedDetailStore.details && (
                  <>
                    <div className="flex items-start text-xs md:text-sm text-[#4A423D] font-medium">
                      <Clock className="w-4 h-4 mr-2.5 text-[#4D8B6F] mt-0.5 shrink-0" />
                      <span>
                        {selectedDetailStore.details.openNow === true && <span className="text-[#4D8B6F] font-bold mr-1.5" title="依 Google 營業時間，實際以店家公告為準">營業中<span className="font-normal text-[10px] text-gray-400 ml-0.5">(Google)</span></span>}
                        {selectedDetailStore.details.openNow === false && <span className="text-rose-600 font-bold mr-1.5">休息中</span>}
                        {todayHours(selectedDetailStore.details.weekdayHours) || '未提供營業時間'}
                      </span>
                    </div>
                    {selectedDetailStore.details.phone && (
                      <div className="flex items-center text-xs md:text-sm text-[#4A423D] font-medium">
                        <Phone className="w-4 h-4 mr-2.5 text-blue-600 shrink-0" />
                        <span>{selectedDetailStore.details.phone}</span>
                      </div>
                    )}
                  </>
                )}
                <div className="flex items-center text-xs md:text-sm font-bold pt-0.5">
                  <Globe className="w-4 h-4 mr-2.5 text-[#B88746] shrink-0" />
                  <a 
                    href={selectedDetailStore.details?.website || selectedDetailStore.details?.googleMapsUri || `https://www.google.com/maps/place/?q=place_id:${selectedDetailStore.id}`}
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="text-[#B88746] hover:text-[#A67C52] underline truncate flex items-center space-x-1"
                  >
                    <span>{selectedDetailStore.details?.website ? '前往店家官方網站' : '在 Google 地圖查看'}</span>
                    <ExternalLink className="w-3 h-3 ml-0.5 inline" />
                  </a>
                </div>
              </div>

              {selectedDetailStore.details && selectedDetailStore.details.reviews.length > 0 && (
                <div className="px-5 pb-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="text-xs md:text-sm font-black text-[#38312D] flex items-center">
                      <span className="w-1.5 h-3.5 rounded-full bg-[#4D8B6F] mr-2"></span>
                      Google 評論
                    </h3>
                    <GoogleMapsAttribution />
                  </div>
                  <p className="text-[10px] text-[#8C7A6B] mb-2.5">
                    依 Google 預設的相關性排序，顯示前 {Math.min(3, selectedDetailStore.details.reviews.length)} 則，未經篩選或改寫。
                    <a href="https://support.google.com/contributionpolicy/answer/7422880" target="_blank" rel="noopener noreferrer" className="underline ml-1">Google 地圖評論政策</a>
                  </p>
                  <div className="space-y-2.5">
                    {selectedDetailStore.details.reviews.slice(0, 3).map((r, i) => (
                      <div key={i} className="bg-white ring-1 ring-[#E8DFD8] rounded-2xl p-3 text-[11px] text-[#4A423D] leading-relaxed">
                        <div className="flex items-center gap-2 mb-1.5">
                          {r.authorPhotoUri
                            ? <img src={r.authorPhotoUri} alt="" referrerPolicy="no-referrer" className="w-6 h-6 rounded-full shrink-0" />
                            : <span className="w-6 h-6 rounded-full bg-[#F0E8DF] shrink-0" />}
                          <span className="font-bold text-[#38312D] truncate flex-1 min-w-0">
                            {r.authorUri
                              ? <a href={r.authorUri} target="_blank" rel="noopener noreferrer" className="hover:underline">{r.author}</a>
                              : r.author}
                          </span>
                          <span className="text-[10px] text-[#A67C52] shrink-0">
                            {r.rating !== null && `${r.rating} ★・`}{r.relativeTime}
                          </span>
                        </div>
                        {/* 預設顯示四行，點一下展開全文（評論不得被截斷成片面內容） */}
                        <p
                          className={expandedReviews.has(i) ? '' : 'line-clamp-4 cursor-pointer'}
                          onClick={() => setExpandedReviews(prev => new Set(prev).add(i))}
                        >
                          {r.text}
                        </p>
                        {!expandedReviews.has(i) && r.text.length > 90 && (
                          <button type="button" onClick={() => setExpandedReviews(prev => new Set(prev).add(i))} className="text-[10px] font-bold text-[#B88746] mt-0.5">
                            展開全文
                          </button>
                        )}
                        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[#A67C52]">
                          {r.translated && <span>由 Google 翻譯</span>}
                          {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="underline">在 Google 地圖查看原文</a>}
                          {r.flagUrl && <a href={r.flagUrl} target="_blank" rel="noopener noreferrer" className="underline">檢舉</a>}
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedDetailStore.details.googleMapsUri && (
                    <a href={selectedDetailStore.details.googleMapsUri} target="_blank" rel="noopener noreferrer" className="inline-block mt-2 text-[11px] font-bold text-[#B88746] underline">
                      在 Google 地圖看全部評論 ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="p-3.5 bg-[#FFFDF9]/90 backdrop-blur-2xl border-t border-[#E8DFD8] shrink-0 pb-safe relative z-20">
            <div className="flex items-center space-x-2">
              {selectedDetailStore.details?.phone ? (
                <a 
                  href={telHref(selectedDetailStore.details.phone)}
                  className="flex-1 bg-[#F7F2EA] hover:bg-[#E8DFD8] text-[#38312D] font-black text-xs sm:text-sm py-3 rounded-2xl flex items-center justify-center transition-all active:scale-95"
                >
                  <Phone className="w-3.5 h-3.5 mr-1 text-blue-600" />
                  通話
                </a>
              ) : (
                <span
                  aria-disabled="true"
                  title={isDetailsLoading ? '正在讀取電話' : 'Google 上沒有這家店的電話'}
                  className="flex-1 bg-[#F7F2EA] text-[#38312D]/40 font-black text-xs sm:text-sm py-3 rounded-2xl flex items-center justify-center cursor-not-allowed"
                >
                  <Phone className="w-3.5 h-3.5 mr-1" />
                  通話
                </span>
              )}

              <button 
                onClick={handleNavigate}
                className="flex-[0.8] bg-[#B88746] hover:bg-[#A67C52] text-white font-black text-xs sm:text-sm py-3 rounded-2xl flex items-center justify-center transition-transform active:scale-95 shadow-lg shadow-[#B88746]/20"
              >
                <Map className="w-3.5 h-3.5 mr-1" />
                導航
              </button>
            </div>
          </div>

        </div>
      )}

      {/* 毛孩生命檔案 Modal */}
      {isPetModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-[#2A2320]/40 backdrop-blur-md animate-in fade-in duration-200">
          <div className="bg-[#FFFDF9]/95 backdrop-blur-3xl w-full max-w-md rounded-[32px] shadow-2xl ring-1 ring-white/80 relative flex flex-col max-h-[90dvh]">
            
            <div className="flex items-center justify-between p-6 pb-4 border-b border-[#E8DFD8] shrink-0">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-2xl bg-[#F7EFE5] text-[#B88746] flex items-center justify-center">
                  <Activity className="w-5 h-5 fill-current" />
                </div>
                <div>
                  <h3 className="font-black text-[#38312D] text-lg">毛孩生命檔案</h3>
                  <p className="text-xs text-[#A67C52] font-bold">健康履歷與 AI 個人化排程</p>
                </div>
              </div>
              <button 
                onClick={() => setIsPetModalOpen(false)}
                className="text-[#A67C52] hover:text-[#38312D] bg-[#F7F2EA] p-2 rounded-full transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6 hide-scrollbar">
              
              <div className="space-y-4">
                <h4 className="text-sm font-black text-[#38312D] flex items-center">
                  <span className="w-1.5 h-4 bg-[#B88746] rounded-full mr-2"></span> 基本資料
                </h4>
                
                <div>
                  <label className="text-xs font-bold text-[#4A423D] mb-1.5 block">毛孩物種</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPetTempProfile({...tempProfile, type: 'dog'})}
                      className={`py-2.5 rounded-2xl text-xs font-bold border flex items-center justify-center space-x-1.5 transition-all ${
                        tempProfile.type === 'dog' 
                          ? 'bg-[#FDF6ED] border-[#B88746] text-[#8C5E2B] ring-2 ring-[#B88746]/20' 
                          : 'bg-[#F7F2EA] border-[#E8DFD8] text-[#6E5A4D]'
                      }`}
                    >
                      <span>🐶 狗狗</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPetTempProfile({...tempProfile, type: 'cat'})}
                      className={`py-2.5 rounded-2xl text-xs font-bold border flex items-center justify-center space-x-1.5 transition-all ${
                        tempProfile.type === 'cat' 
                          ? 'bg-[#F9F0F5] border-[#D982A6] text-[#8C3A62] ring-2 ring-[#D982A6]/20' 
                          : 'bg-[#F7F2EA] border-[#E8DFD8] text-[#6E5A4D]'
                      }`}
                    >
                      <span>🐱 貓咪</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">名字</label>
                    <input 
                      type="text"
                      value={tempProfile.name}
                      onChange={(e) => setPetTempProfile({...tempProfile, name: e.target.value})}
                      placeholder="例如：來福"
                      className="w-full bg-[#F7F2EA] border border-[#E8DFD8] rounded-xl px-3 py-2.5 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#B88746]/20 focus:border-[#B88746]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">品種</label>
                    <input 
                      type="text"
                      value={tempProfile.breed}
                      onChange={(e) => setPetTempProfile({...tempProfile, breed: e.target.value})}
                      placeholder="例如：柴犬"
                      className="w-full bg-[#F7F2EA] border border-[#E8DFD8] rounded-xl px-3 py-2.5 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#B88746]/20 focus:border-[#B88746]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 flex items-center justify-between">
                      生日 
                      <span className="text-[10px] text-[#B88746] font-bold">({calculateAge(tempProfile.birthday)})</span>
                    </label>
                    <input 
                      type="date"
                      value={tempProfile.birthday}
                      onChange={(e) => setPetTempProfile({...tempProfile, birthday: e.target.value})}
                      className="w-full bg-[#F7F2EA] border border-[#E8DFD8] rounded-xl px-3 py-2 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#B88746]/20 focus:border-[#B88746]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">體重</label>
                    <input 
                      type="text"
                      value={tempProfile.weight}
                      onChange={(e) => setPetTempProfile({...tempProfile, weight: e.target.value})}
                      placeholder="例如：10.5 kg"
                      className="w-full bg-[#F7F2EA] border border-[#E8DFD8] rounded-xl px-3 py-2.5 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#B88746]/20 focus:border-[#B88746]"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-bold text-[#4A423D] mb-1 flex items-center justify-between">
                    <span>注意事項 / 特殊需求</span>
                    <span className="text-[10px] text-[#E07A5F] flex items-center font-bold">
                      <AlertCircle className="w-3 h-3 mr-0.5" /> AI 將優先避開風險
                    </span>
                  </label>
                  <textarea 
                    value={tempProfile.notes}
                    onChange={(e) => setPetTempProfile({...tempProfile, notes: e.target.value})}
                    rows={2}
                    placeholder="例如：個性較緊張怕生、對雞肉過敏..."
                    className="w-full bg-[#F7F2EA] border border-[#E8DFD8] rounded-xl px-3 py-2 text-sm font-medium text-[#38312D] outline-none focus:ring-2 focus:ring-[#B88746]/20 focus:border-[#B88746] leading-relaxed resize-none"
                  />
                </div>
              </div>

              <div className="space-y-4 pt-4 border-t border-[#E8DFD8]">
                <h4 className="text-sm font-black text-[#38312D] flex items-center">
                  <span className="w-1.5 h-4 bg-[#4D8B6F] rounded-full mr-2"></span> 健康與預防醫學
                  <span className="ml-2 text-[10px] font-bold text-[#4D8B6F] bg-[#EBF4EE] px-2 py-0.5 rounded-md">AI 自動排程推播</span>
                </h4>

                <div className="bg-[#EBF4EE]/60 border border-[#CDE3DC] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center text-[#3B6E57] font-black text-xs mb-2">
                    <Pill className="w-4 h-4 mr-1.5" /> 定期驅蟲 / 心絲蟲用藥
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">使用廠牌名稱</label>
                    <input 
                      type="text"
                      value={tempProfile.medBrand}
                      onChange={(e) => setPetTempProfile({...tempProfile, medBrand: e.target.value})}
                      placeholder="例如：全能狗S、犬新寶、一錠除..."
                      className="w-full bg-white border border-[#CDE3DC] rounded-xl px-3 py-2 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#4D8B6F]/20 focus:border-[#4D8B6F]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">上次服用日期</label>
                    <input 
                      type="date"
                      value={tempProfile.medLastDate}
                      onChange={(e) => setPetTempProfile({...tempProfile, medLastDate: e.target.value})}
                      className="w-full bg-white border border-[#CDE3DC] rounded-xl px-3 py-2 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#4D8B6F]/20 focus:border-[#4D8B6F]"
                    />
                  </div>
                </div>

                <div className="bg-[#EBF2F8]/60 border border-[#CBDDE9] rounded-2xl p-4 space-y-3">
                  <div className="flex items-center text-[#2D5B84] font-black text-xs mb-2">
                    <Syringe className="w-4 h-4 mr-1.5" /> 年度核心疫苗紀錄
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">疫苗名稱</label>
                    <input 
                      type="text"
                      value={tempProfile.vaccineName}
                      onChange={(e) => setPetTempProfile({...tempProfile, vaccineName: e.target.value})}
                      placeholder="例如：十合一疫苗、狂犬病疫苗"
                      className="w-full bg-white border border-[#CBDDE9] rounded-xl px-3 py-2 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#2D5B84]/20 focus:border-[#2D5B84]"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-[#4A423D] mb-1 block">上次施打日期</label>
                    <input 
                      type="date"
                      value={tempProfile.vaccineLastDate}
                      onChange={(e) => setPetTempProfile({...tempProfile, vaccineLastDate: e.target.value})}
                      className="w-full bg-white border border-[#CBDDE9] rounded-xl px-3 py-2 text-sm font-bold text-[#38312D] outline-none focus:ring-2 focus:ring-[#2D5B84]/20 focus:border-[#2D5B84]"
                    />
                  </div>
                </div>

              </div>
            </div>

            {authStatus !== 'authenticated' && authProviders.length > 0 && (
              <p className="px-6 pt-3 text-[11px] text-[#A67C52] bg-[#FFFDF9]">
                目前未登入，檔案只會存在這台裝置。按右上角「登入」即可存進帳號。
              </p>
            )}
            <div className="px-6 py-4 border-t border-[#E8DFD8] flex space-x-3 shrink-0 bg-[#FFFDF9]">
              <button
                onClick={() => setIsPetModalOpen(false)}
                className="flex-[0.5] bg-[#F7F2EA] hover:bg-[#E8DFD8] text-[#4A423D] font-black text-sm py-3.5 rounded-2xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSavePetProfile}
                className="flex-1 bg-[#B88746] hover:bg-[#A67C52] text-white font-black text-sm py-3.5 rounded-2xl shadow-lg shadow-[#B88746]/20 transition-transform active:scale-95"
              >
                儲存檔案並更新 AI 排程
              </button>
            </div>

          </div>
        </div>
      )}

      {/* 定位載入中 UI */}
      {notice && (
        <div role="status" className="absolute top-20 md:top-6 left-1/2 -translate-x-1/2 z-[90] bg-[#38312D]/90 backdrop-blur-md text-white text-xs md:text-sm font-bold px-4 py-2.5 rounded-full shadow-lg pointer-events-none max-w-[90vw] text-center">
          {notice}
        </div>
      )}

      {locationStatus === 'loading' && (
        <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-[#FAF6F0]/80 backdrop-blur-sm">
          <div className="bg-white rounded-3xl p-6 shadow-xl flex flex-col items-center max-w-xs text-center border border-[#E8DFD8]">
            <div className="w-16 h-16 mb-4 animate-bounce">
              <span className="text-5xl">🛰️</span>
            </div>
            <h3 className="text-[#38312D] font-black text-lg mb-2">正在與外太空連線...</h3>
            <p className="text-[#6E5A4D] text-sm font-bold leading-relaxed">
              正在為您定位中！請稍候，我們保證沒有被外星人綁架 👽
            </p>
          </div>
        </div>
      )}

      {/* 定位被拒絕 UI */}
      {/* 沒有定位：不擋畫面，只在上方提示一次 */}
      {locationStatus === 'denied' && (
        <div role="status" className="absolute z-[25] left-3 right-3 top-[156px] md:top-24 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[440px] pointer-events-auto bg-[#FFFDF9]/95 backdrop-blur-xl rounded-2xl shadow-lg ring-1 ring-[#E8DFD8] px-4 py-3 flex items-start gap-3 animate-in fade-in">
          <MapPin className="w-4 h-4 mt-0.5 text-[#B88746] shrink-0" aria-hidden="true" />
          <p className="flex-1 text-xs leading-relaxed text-[#4A423D]">
            沒有取得你的位置，先以<b>台北市大安區</b>為中心。到瀏覽器設定允許「位置」後重新整理，就能找你附近的店；也可以直接跟 AI 說地點。
          </p>
          <button type="button" onClick={() => setLocationStatus('error')} aria-label="關閉提示" className="p-1 -m-1 text-[#A67C52] hover:text-[#38312D]">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}