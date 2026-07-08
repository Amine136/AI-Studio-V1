// Shared constants + i18n for the Packs UI. Kept local to the packs route so we
// don't touch the 1.8k-line global translations file. Arabic is the default
// language; numerals follow the locale.
import type { Language } from "../../../context/LanguageContext";
import type { PackCapability } from "../../../types";

// Display order of sectors in the gallery rail (Arabic-first market priority).
export const SECTOR_ORDER = [
  "ecommerce",
  "social",
  "quote",
  "digital",
  "food",
  "fashion",
  "realestate",
  "events",
  "beauty",
  "arabic",
];

// Pinned (starred) sectors shown with a ★ accent.
export const PINNED_SECTORS = new Set(["arabic"]);

// Capability → neutral material-symbol glyph (trust signal on cards). The
// calligraphy glyph is a plain pen/brush, never a sacred ligature.
export const CAPABILITY_GLYPH: Record<PackCapability, string> = {
  photoreal: "photo_camera",
  "edit-from-reference": "auto_fix_high",
  "text-in-image": "title",
  "vector-graphic": "category",
  calligraphy: "brush",
};

// The "Crafts Index" color system: the page is monochrome ink-on-dark and the
// ONLY hue comes from these five craft accents (a muted museum-label spectrum),
// used on the specimen art, filter dots, and card craft label. Tuned to read on
// the dark canvas.
export const CRAFT_HEX: Record<PackCapability, string> = {
  photoreal: "#4fc2a4",
  "text-in-image": "#e7ad4d",
  "edit-from-reference": "#9d8cf0",
  "vector-graphic": "#5b93ea",
  calligraphy: "#e26d80",
};

// Filter/display order for the craft strip (most-common first).
export const CRAFT_ORDER: PackCapability[] = [
  "photoreal",
  "text-in-image",
  "edit-from-reference",
  "vector-graphic",
  "calligraphy",
];

type Dict = Record<string, string>;

const SECTOR_LABELS: Record<Language, Dict> = {
  en: {
    ecommerce: "E-commerce",
    food: "Food",
    fashion: "Fashion",
    realestate: "Real estate",
    social: "Social",
    quote: "Quote",
    digital: "Digital products",
    events: "Events",
    beauty: "Beauty",
    arabic: "Arabic & local",
  },
  fr: {
    ecommerce: "E-commerce",
    food: "Restauration",
    fashion: "Mode",
    realestate: "Immobilier",
    social: "Réseaux",
    quote: "Citations",
    digital: "Produits digitaux",
    events: "Événements",
    beauty: "Beauté",
    arabic: "Arabe & local",
  },
  ar: {
    ecommerce: "التجارة",
    food: "المطاعم",
    fashion: "الأزياء",
    realestate: "العقارات",
    social: "المحتوى",
    quote: "اقتباسات",
    digital: "منتجات رقمية",
    events: "المناسبات",
    beauty: "التجميل",
    arabic: "عربي ومحلّي",
  },
};

// One-line editorial descriptor per sector — the masthead sub-line. Plain,
// useful, written from the shop owner's side of the screen.
const SECTOR_DESC: Record<Language, Dict> = {
  en: {
    ecommerce: "Product shots, scenes, and promos — store-ready in a tap.",
    food: "Dishes, menus, and specials that make people hungry.",
    fashion: "Designs, mockups, and flat-lays for what you make and sell.",
    realestate: "Stage, relight, and brand your listings.",
    social: "Profile cards, posts and 3D mockups — drop in your photo and details.",
    quote: "Quote cards and typographic posts — add your words, pick a style.",
    digital: "Promo posters for subscriptions, top-ups and gift cards — swap in your product, price and contact.",
    events: "Invitations, stories, and thank-yous for the big day.",
    beauty: "Menus, promos, and hero shots for your salon or clinic.",
    arabic: "Calligraphy, patterns, and campaigns rooted in the local market.",
  },
  fr: {
    ecommerce: "Photos produit, mises en scène et promos — prêtes à vendre.",
    food: "Plats, menus et offres qui donnent faim.",
    fashion: "Designs, mockups et flat-lays pour ce que vous créez.",
    realestate: "Home-staging, ambiance et habillage de vos annonces.",
    social: "Cartes de profil, posts et mockups 3D — ajoutez votre photo et vos infos.",
    quote: "Cartes de citation et posts typographiques — ajoutez vos mots, choisissez un style.",
    digital: "Affiches promo d'abonnements, recharges et cartes cadeaux — mettez votre produit, prix et contact.",
    events: "Invitations, stories et remerciements pour le grand jour.",
    beauty: "Menus, promos et visuels d’accroche pour votre salon.",
    arabic: "Calligraphie, motifs et campagnes ancrés dans le marché local.",
  },
  ar: {
    ecommerce: "صور المنتجات والمشاهد والعروض — جاهزة للبيع بضغطة.",
    food: "أطباق وقوائم وعروض تفتح الشهية.",
    fashion: "تصاميم وموكاب وصور مسطّحة لما تصنعه وتبيعه.",
    realestate: "تأثيث وإضاءة وهوية لإعلاناتك العقارية.",
    social: "بطاقات تعريف ومنشورات وموكاب ثلاثي الأبعاد — أضف صورتك وبياناتك.",
    quote: "بطاقات اقتباس ومنشورات نصية — أضف كلماتك واختر التصميم.",
    digital: "ملصقات ترويجية للاشتراكات والشحن والبطاقات — ضع منتجك وسعرك وتواصلك.",
    events: "دعوات وقصص وبطاقات شكر ليومك المميّز.",
    beauty: "قوائم وعروض وصور رئيسية لصالونك أو عيادتك.",
    arabic: "خط عربي وزخارف وحملات نابعة من السوق المحلّي.",
  },
};

const CAPABILITY_LABELS: Record<Language, Record<PackCapability, string>> = {
  en: {
    photoreal: "Photoreal",
    "edit-from-reference": "Edit from photo",
    "text-in-image": "Text in image",
    "vector-graphic": "Vector",
    calligraphy: "Calligraphy",
  },
  fr: {
    photoreal: "Photoréaliste",
    "edit-from-reference": "Édition photo",
    "text-in-image": "Texte intégré",
    "vector-graphic": "Vectoriel",
    calligraphy: "Calligraphie",
  },
  ar: {
    photoreal: "واقعي",
    "edit-from-reference": "تحرير صورة",
    "text-in-image": "نص داخل الصورة",
    "vector-graphic": "رسم متجهي",
    calligraphy: "خط عربي",
  },
};

export const PACK_STRINGS: Record<Language, Dict> = {
  en: {
    brand: "Vibecraft",
    packs: "Packs",
    sectors: "Sectors",
    catalog: "Catalog",
    homeMarket: "Home market",
    allCrafts: "All",
    needsPhoto: "Needs a photo",
    justDescribe: "Just describe",
    search: "Search packs…",
    new: "New",
    packsCount: "packs",
    emptySector: "No packs here yet.",
    unavailable: "This pack is not available right now.",
    back: "Packs",
    example: "Example result — what you get",
    referenceOptional: "Reference photo (optional)",
    referenceRequired: "Reference photo",
    upload: "Upload a photo",
    orSkip: "or skip",
    howMany: "How many",
    aspectRatio: "Aspect ratio",
    size: "Size",
    recommended: "Recommended",
    otherModels: "Other models",
    fewerModels: "Show fewer",
    willCost: "This will cost",
    credits: "credits",
    images: "images",
    image: "image",
    balanceAfter: "Balance after:",
    generate: "Generate",
    generatingShort: "generating…",
    results: "Results",
    downloadAll: "Download all",
    variant: "Make a variant",
    caption: "Write a caption",
    edit: "Edit",
    resize: "Resize",
    download: "Download",
    soon: "Soon",
    tileFailed: "This could not be generated.",
    tileSkipped: "Skipped — please try again.",
    ctaNote: "Each action shows its cost before it runs.",
    notEnough: "Not enough credits",
    required: "required",
    fillRequired: "Fill the required fields to continue.",
    confirmTitle: "Generate {n} images?",
    confirmBody: "{total} credits · balance → {after}",
    cancel: "Cancel",
    confirm: "Yes, generate",
    loading: "Loading…",
    retry: "Retry",
    blocked: "This request could not be processed by our safety checks. No credits were charged.",
    applyToMany: "Apply to many",
    batchUpload: "Upload references (drag many)",
    batchList: "One value per line",
    batchListPlaceholder: "e.g. one product per line",
    sharedSettings: "Shared settings (applied to all)",
    oneEach: "1 each",
    validCount: "valid",
    invalidCount: "invalid",
    excludedNote: "Invalid files are excluded from the count and the cost.",
    generateCount: "Generate {n}",
    batchEmpty: "Add images or a list to begin.",
    lowBalance: "low — top up?",
    addMore: "Add more",
    itemRetry: "Retry this one",
    batchDone: "{ok} of {total} done",
    pickMockup: "Pick a mockup to start",
    changeMockup: "Change mockup",
    uploadDesign: "Upload your design (optional)",
    studio: "Studio",
    describeIdea: "Describe what you want",
    describePlaceholder: "e.g. a luxury perfume bottle on white marble, soft light",
    planning: "Preparing your plan…",
    reviewPlan: "Review & generate",
    planSummaryLabel: "What we'll create",
    model: "Model",
    quality: "Quality",
    agentAsks: "One quick question",
    yourAnswer: "Type your answer…",
    continue: "Continue",
    skipAndGenerate: "Skip & generate anyway",
    multiImageHint: "Images are read in order (1, 2, 3) — say how to combine them, e.g. “put the logo from image 2 on the shirt in image 1”.",
    chatEmpty: "Describe what you want to create. Attach a photo, and reuse any result in your next request.",
    chatPlaceholder: "Describe your image…",
    thinking: "Thinking",
    useInNext: "Use in next",
    mockupChip: "Mockup attached",
    mockupOff: "Add scene",
    refsFull: "You've reached the image limit for this model.",
    imageRequired: "This pack requires an image. Please select a scene or attach your design.",
    dropImagesHere: "Drop images here",
    sessions: "Sessions",
    newSession: "New",
    untitledSession: "New session",
    noSessions: "No saved sessions yet.",
    rename: "Rename",
    delete: "Delete",
        studioBegin: 'Describe your image to begin',
    studioEmptyHint: 'Your scene is attached below — just say what to place in it, or start from a blank canvas.',
    sceneLabel: 'Reference scene',
    blankCanvas: 'Blank canvas',
    sessionLoadFailed: "Could not open that session.",
  },
  fr: {
    brand: "Vibecraft",
    packs: "Packs",
    sectors: "Secteurs",
    catalog: "Catalogue",
    homeMarket: "Marché local",
    allCrafts: "Tout",
    needsPhoto: "Photo requise",
    justDescribe: "À décrire",
    search: "Rechercher…",
    new: "Nouveau",
    packsCount: "packs",
    emptySector: "Aucun pack ici pour l’instant.",
    unavailable: "Ce pack n’est pas disponible actuellement.",
    back: "Packs",
    example: "Exemple de résultat",
    referenceOptional: "Photo de référence (optionnel)",
    referenceRequired: "Photo de référence",
    upload: "Importer une photo",
    orSkip: "ou ignorer",
    howMany: "Combien",
    aspectRatio: "Format",
    size: "Taille",
    recommended: "Recommandé",
    otherModels: "Autres modèles",
    fewerModels: "Réduire",
    willCost: "Cela coûtera",
    credits: "crédits",
    images: "images",
    image: "image",
    balanceAfter: "Solde après :",
    generate: "Générer",
    generatingShort: "génération…",
    results: "Résultats",
    downloadAll: "Tout télécharger",
    variant: "Une variante",
    caption: "Écrire une légende",
    edit: "Modifier",
    resize: "Redimensionner",
    download: "Télécharger",
    soon: "Bientôt",
    tileFailed: "Impossible de générer ceci.",
    tileSkipped: "Ignoré — réessayez.",
    ctaNote: "Chaque action affiche son coût avant de s’exécuter.",
    notEnough: "Crédits insuffisants",
    required: "requis",
    fillRequired: "Remplissez les champs requis pour continuer.",
    confirmTitle: "Générer {n} images ?",
    confirmBody: "{total} crédits · solde → {after}",
    cancel: "Annuler",
    confirm: "Oui, générer",
    loading: "Chargement…",
    retry: "Réessayer",
    blocked: "Cette demande n’a pas pu être traitée par nos contrôles de sécurité. Aucun crédit n’a été débité.",
    applyToMany: "Appliquer à plusieurs",
    batchUpload: "Importer des références (glissez-en plusieurs)",
    batchList: "Une valeur par ligne",
    batchListPlaceholder: "ex. un produit par ligne",
    sharedSettings: "Réglages partagés (appliqués à tous)",
    oneEach: "1 chacun",
    validCount: "valides",
    invalidCount: "non valides",
    excludedNote: "Les fichiers non valides sont exclus du nombre et du coût.",
    generateCount: "Générer {n}",
    batchEmpty: "Ajoutez des images ou une liste pour commencer.",
    lowBalance: "faible — recharger ?",
    addMore: "Ajouter",
    itemRetry: "Réessayer celui-ci",
    batchDone: "{ok} sur {total} terminés",
    pickMockup: "Choisissez un mockup pour commencer",
    changeMockup: "Changer de mockup",
    uploadDesign: "Importez votre design (optionnel)",
    studio: "Studio",
    describeIdea: "Décrivez ce que vous voulez",
    describePlaceholder: "ex. un flacon de parfum de luxe sur marbre blanc, lumière douce",
    planning: "Préparation de votre plan…",
    reviewPlan: "Vérifier & générer",
    planSummaryLabel: "Ce que nous allons créer",
    model: "Modèle",
    quality: "Qualité",
    agentAsks: "Une petite question",
    yourAnswer: "Votre réponse…",
    continue: "Continuer",
    skipAndGenerate: "Ignorer & générer",
    multiImageHint: "Les images sont lues dans l’ordre (1, 2, 3) — précisez comment les combiner, ex. « mettez le logo de l’image 2 sur le t-shirt de l’image 1 ».",
    chatEmpty: "Décrivez ce que vous voulez créer. Ajoutez une photo et réutilisez n’importe quel résultat dans votre prochaine demande.",
    chatPlaceholder: "Décrivez votre image…",
    thinking: "Réflexion",
    useInNext: "Réutiliser",
    mockupChip: "Mockup ajouté",
    mockupOff: "Ajouter le décor",
    refsFull: "Vous avez atteint la limite d’images pour ce modèle.",
    imageRequired: "Ce pack nécessite une image. Sélectionnez une scène ou importez votre design.",
    dropImagesHere: "Déposez vos images ici",
    sessions: "Sessions",
    newSession: "Nouveau",
    untitledSession: "Nouvelle session",
    noSessions: "Aucune session enregistrée.",
    rename: "Renommer",
    delete: "Supprimer",
        studioBegin: 'Décrivez votre image pour commencer',
    studioEmptyHint: 'Votre décor est joint ci-dessous — dites simplement quoi y placer, ou partez d’une toile vierge.',
    sceneLabel: 'Décor de référence',
    blankCanvas: 'Toile vierge',
    sessionLoadFailed: "Impossible d’ouvrir cette session.",
  },
  ar: {
    brand: "Vibecraft",
    packs: "باقات",
    sectors: "الأقسام",
    catalog: "الفهرس",
    homeMarket: "السوق المحلّي",
    allCrafts: "الكل",
    needsPhoto: "تحتاج صورة",
    justDescribe: "بالوصف فقط",
    search: "ابحث في الباقات…",
    new: "جديد",
    packsCount: "باقات",
    emptySector: "لا توجد باقات هنا بعد.",
    unavailable: "هذه الباقة غير متاحة حاليًا.",
    back: "الباقات",
    example: "مثال على النتيجة",
    referenceOptional: "صورة مرجعية (اختياري)",
    referenceRequired: "صورة مرجعية",
    upload: "ارفع صورة",
    orSkip: "أو تخطَّ",
    howMany: "العدد",
    aspectRatio: "الأبعاد",
    size: "المقاس",
    recommended: "موصى به",
    otherModels: "نماذج أخرى",
    fewerModels: "إخفاء",
    willCost: "ستكلّف",
    credits: "رصيد",
    images: "صور",
    image: "صورة",
    balanceAfter: "الرصيد بعدها:",
    generate: "توليد",
    generatingShort: "جارٍ التوليد…",
    results: "النتائج",
    downloadAll: "تحميل الكل",
    variant: "نسخة أخرى",
    caption: "اكتب وصفًا",
    edit: "تعديل",
    resize: "تغيير الأبعاد",
    download: "تحميل",
    soon: "قريبًا",
    tileFailed: "تعذّر توليد هذه الصورة.",
    tileSkipped: "تم التخطّي — حاول مجددًا.",
    ctaNote: "كل إجراء يعرض تكلفته قبل تنفيذه.",
    notEnough: "الرصيد غير كافٍ",
    required: "مطلوب",
    fillRequired: "أكمل الحقول المطلوبة للمتابعة.",
    confirmTitle: "توليد {n} صور؟",
    confirmBody: "{total} رصيد · الرصيد ← {after}",
    cancel: "إلغاء",
    confirm: "نعم، ولّد",
    loading: "جارٍ التحميل…",
    retry: "إعادة المحاولة",
    blocked: "تعذّر معالجة هذا الطلب عبر فحوصات الأمان. لم يُخصم أي رصيد.",
    applyToMany: "تطبيق على عدّة",
    batchUpload: "ارفع صورًا مرجعية (اسحب عدّة)",
    batchList: "قيمة واحدة في كل سطر",
    batchListPlaceholder: "مثال: منتج واحد في كل سطر",
    sharedSettings: "إعدادات مشتركة (تُطبَّق على الكل)",
    oneEach: "١ لكل",
    validCount: "صالحة",
    invalidCount: "غير صالحة",
    excludedNote: "الملفات غير الصالحة مستثناة من العدد والتكلفة.",
    generateCount: "ولّد {n}",
    batchEmpty: "أضف صورًا أو قائمة للبدء.",
    lowBalance: "منخفض — اشحن؟",
    addMore: "إضافة",
    itemRetry: "أعد هذه",
    batchDone: "{ok} من {total} اكتمل",
    pickMockup: "اختر مشهدًا للبدء",
    changeMockup: "غيّر المشهد",
    uploadDesign: "ارفع تصميمك (اختياري)",
    studio: "الاستوديو",
    describeIdea: "صِف ما تريد",
    describePlaceholder: "مثال: زجاجة عطر فاخرة على رخام أبيض، إضاءة ناعمة",
    planning: "جارٍ تحضير خطّتك…",
    reviewPlan: "راجع وولّد",
    planSummaryLabel: "ما الذي سننشئه",
    model: "النموذج",
    quality: "الجودة",
    agentAsks: "سؤال سريع",
    yourAnswer: "اكتب إجابتك…",
    continue: "متابعة",
    skipAndGenerate: "تخطَّ وولّد",
    multiImageHint: "تُقرأ الصور بالترتيب (١، ٢، ٣) — وضّح كيف تُدمج، مثال: «ضع شعار الصورة ٢ على القميص في الصورة ١».",
    chatEmpty: "صِف ما تريد إنشاءه. أرفق صورة، وأعد استخدام أي نتيجة في طلبك التالي.",
    chatPlaceholder: "صِف صورتك…",
    thinking: "جارٍ التفكير",
    useInNext: "استخدمها تاليًا",
    mockupChip: "تم إرفاق المشهد",
    mockupOff: "إضافة المشهد",
    refsFull: "لقد بلغت حدّ الصور لهذا النموذج.",
    imageRequired: "يتطلب هذا الحزمة صورة. اختر مشهدًا أو أرفق تصميمك.",
    dropImagesHere: "أفلت الصور هنا",
    sessions: "الجلسات",
    newSession: "جديد",
    untitledSession: "جلسة جديدة",
    noSessions: "لا توجد جلسات محفوظة بعد.",
    rename: "إعادة تسمية",
    delete: "حذف",
        studioBegin: 'صِف صورتك للبدء',
    studioEmptyHint: 'مشهدك مُرفق بالأسفل — قل فقط ما تريد وضعه فيه، أو ابدأ من مساحة فارغة.',
    sceneLabel: 'مشهد مرجعي',
    blankCanvas: 'مساحة فارغة',
    sessionLoadFailed: "تعذّر فتح هذه الجلسة.",
  },
};

export function pt(language: Language, key: string): string {
  return PACK_STRINGS[language]?.[key] ?? PACK_STRINGS.en[key] ?? key;
}

export function sectorLabel(language: Language, sector: string): string {
  return SECTOR_LABELS[language]?.[sector] ?? SECTOR_LABELS.en[sector] ?? sector;
}

export function sectorDesc(language: Language, sector: string): string {
  return SECTOR_DESC[language]?.[sector] ?? SECTOR_DESC.en[sector] ?? "";
}

export function capabilityLabel(language: Language, cap: PackCapability): string {
  return CAPABILITY_LABELS[language]?.[cap] ?? CAPABILITY_LABELS.en[cap] ?? cap;
}

// Friendly labels for the raw quality/resolution tiers the models expose
// (low/medium for gpt-image, 1k/2k for grok). Unknown tiers pass through.
const QUALITY_LABELS: Record<Language, Dict> = {
  en: { low: "Standard", medium: "High", "1k": "1K", "2k": "2K" },
  fr: { low: "Standard", medium: "Élevée", "1k": "1K", "2k": "2K" },
  ar: { low: "عادية", medium: "عالية", "1k": "1K", "2k": "2K" },
};

export function qualityLabel(language: Language, tier: string): string {
  return QUALITY_LABELS[language]?.[tier] ?? QUALITY_LABELS.en[tier] ?? tier;
}

const AR_DIGITS = ["٠", "١", "٢", "٣", "٤", "٥", "٦", "٧", "٨", "٩"];

// Locale-aware numerals: Arabic-Indic in `ar`, Western elsewhere. Accepts a
// number; trims trailing zeros for credit amounts.
export function fmtNum(language: Language, value: number, maxFractionDigits = 2): string {
  const rounded = Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(maxFractionDigits)));
  if (language !== "ar") return rounded;
  return rounded.replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);
}

// --- Output-shape helpers (shared by the confirm-modal aspect/size pickers) ---
// A model's output-shape control carries EITHER ratio strings ("16:9", "16x9")
// OR pixel sizes ("1024x1024"), plus the odd non-shape token ("auto"). Parse a
// value into a width/height proportion; null when it isn't a shape. Mirrors the
// backend `_ratio_to_float` so the picker draws exactly what the model accepts.
export function parseShapeRatio(value: string): number | null {
  const v = (value || "").trim().toLowerCase();
  for (const sep of [":", "x"]) {
    if (v.includes(sep)) {
      const parts = v.split(sep);
      if (parts.length === 2) {
        const w = Number(parts[0]);
        const h = Number(parts[1]);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) return w / h;
      }
    }
  }
  return null;
}

// The section label follows what the values look like: pixel dimensions
// (e.g. "1024x1024") read as a "Size" control, ratio strings as "Aspect ratio".
// Returns a `pt` key so callers stay i18n-consistent.
export function aspectFieldKey(options: string[]): "size" | "aspectRatio" {
  const looksPixel = options.some((o) => {
    const parts = (o || "").toLowerCase().split(/[:x]/);
    return parts.length === 2 && Number(parts[0]) >= 100 && Number(parts[1]) >= 100;
  });
  return looksPixel ? "size" : "aspectRatio";
}

// Display form for a shape value: "1024x1024" → "1024×1024", "auto" → "Auto".
export function prettyShape(value: string): string {
  if (!value) return value;
  if (value.trim().toLowerCase() === "auto") return "Auto";
  return value.replace(/x/gi, "×");
}
