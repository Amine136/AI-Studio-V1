import type { Language } from "../context/LanguageContext";

/**
 * Hardcoded, fully localized model descriptions keyed by the model slug
 * (the `id` returned by /chat/models, e.g. "gemini-2.5-flash").
 *
 * This is intentionally the single source of truth for what users see in the
 * model picker — the free-text `description` coming from ApiKeyManager is NOT
 * used for display. To document a new model, add one entry here. Any model not
 * listed falls back to a generic localized line at the call site, so it never
 * renders blank.
 */
export type LocalizedModelDescription = Record<Language, string>;

export const MODEL_DESCRIPTIONS: Record<string, LocalizedModelDescription> = {
  "gpt-image-1-mini": {
    en: "OpenAI's budget, ultra-fast image engine built for rapid drafts and high-volume pipelines.",
    fr: "Le moteur d'images économique et ultra-rapide d'OpenAI, conçu pour les brouillons rapides et les flux à grand volume.",
    ar: "محرك صور اقتصادي وفائق السرعة من OpenAI، مصمَّم للمسودّات السريعة والأعمال ذات الحجم الكبير.",
  },
  "gpt-image-1.5": {
    en: "OpenAI's reliable previous-generation workhorse for standard image-to-image edits and clean prompt-following.",
    fr: "La valeur sûre de génération précédente d'OpenAI pour les retouches image-à-image classiques et un suivi fidèle des instructions.",
    ar: "النموذج الموثوق من الجيل السابق لدى OpenAI لتعديلات الصورة-إلى-صورة المعتادة والالتزام الدقيق بالتعليمات.",
  },
  "gpt-image-2": {
    en: "OpenAI's state-of-the-art model for complex visual tasks, producing precise, ready-to-use images.",
    fr: "Le modèle de pointe d'OpenAI pour les tâches visuelles complexes, générant des images précises et prêtes à l'emploi.",
    ar: "النموذج الأحدث من OpenAI للمهام البصرية المعقّدة، يُنتج صورًا دقيقة وجاهزة للاستخدام.",
  },
  "gemini-2.5-flash": {
    en: "Google's fast multimodal text model with image understanding.",
    fr: "Le modèle de texte multimodal rapide de Google, doté de la compréhension d'images.",
    ar: "نموذج نصّي متعدد الوسائط وسريع من Google مع القدرة على فهم الصور.",
  },
  "gemini-3-flash-preview": {
    en: "Preview of Google's next-generation fast text model with multimodal input.",
    fr: "Aperçu du modèle de texte rapide nouvelle génération de Google, avec entrée multimodale.",
    ar: "إصدار تجريبي من نموذج النصوص السريع للجيل القادم من Google مع إدخال متعدد الوسائط.",
  },
  "gemini-3.1-flash-lite-preview": {
    en: "A lightweight, low-cost variant of Gemini 3.1 Flash for efficient text tasks.",
    fr: "Une variante légère et économique de Gemini 3.1 Flash pour des tâches de texte efficaces.",
    ar: "نسخة خفيفة ومنخفضة التكلفة من Gemini 3.1 Flash لمهام النصوص بكفاءة.",
  },
  "gemini-3.5-flash": {
    en: "A high-performance, agent-focused model for complex reasoning and large-scale output at production speed.",
    fr: "Un modèle haute performance orienté agents, pour le raisonnement complexe et la génération à grande échelle à vitesse de production.",
    ar: "نموذج عالي الأداء موجَّه للوكلاء، للاستدلال المعقّد وإنتاج مخرجات واسعة النطاق بسرعة الإنتاج.",
  },
  "grok-imagine-image": {
    en: "A budget-friendly tier for rapid edits — tweak compositions and test ideas at low cost.",
    fr: "Une formule économique pour des retouches rapides : ajustez les compositions et testez vos idées à moindre coût.",
    ar: "فئة اقتصادية للتعديلات السريعة؛ عدّل التركيبات وجرّب أفكارك بتكلفة منخفضة.",
  },
  "grok-imagine-image-quality": {
    en: "Generates premium, high-resolution images from scratch based on text prompts.",
    fr: "Génère des images haut de gamme en haute résolution à partir de zéro, sur la base d'instructions textuelles.",
    ar: "يُولّد صورًا فاخرة وعالية الدقة من الصفر استنادًا إلى الأوصاف النصية.",
  },
  "grok-imagine-image-quality-editing": {
    en: "Edits up to three existing images from natural-language instructions while keeping premium detail.",
    fr: "Modifie jusqu'à trois images existantes à partir d'instructions en langage naturel, tout en préservant un niveau de détail haut de gamme.",
    ar: "يعدّل حتى ثلاث صور موجودة بناءً على تعليمات بلغة طبيعية مع الحفاظ على تفاصيل فاخرة.",
  },
  "ideogram-v3-generate-transparent": {
    en: "Generates images with a transparent background using Ideogram 3.0.",
    fr: "Génère des images à fond transparent à l'aide d'Ideogram 3.0.",
    ar: "يُولّد صورًا بخلفية شفافة باستخدام Ideogram 3.0.",
  },
  "ideogram-v3-generate": {
    en: "Generates images from a text prompt using the Ideogram 3.0 model.",
    fr: "Génère des images à partir d'une instruction textuelle avec le modèle Ideogram 3.0.",
    ar: "يُولّد صورًا من وصف نصّي باستخدام نموذج Ideogram 3.0.",
  },
  "imagen-4.0-fast-generate-001": {
    en: "A faster, lighter version of Imagen 4, optimized for quick image generation.",
    fr: "Une version plus rapide et plus légère d'Imagen 4, optimisée pour une génération d'images rapide.",
    ar: "نسخة أسرع وأخف من Imagen 4، محسّنة لتوليد الصور بسرعة.",
  },
  "imagen-4.0-generate-001": {
    en: "Google's default text-to-image model, balancing quality and speed.",
    fr: "Le modèle texte-vers-image par défaut de Google, alliant qualité et rapidité.",
    ar: "نموذج Google الافتراضي لتحويل النص إلى صورة، يوازن بين الجودة والسرعة.",
  },
  "imagen-4.0-ultra-generate-001": {
    en: "The highest-quality Imagen 4 tier, best for detailed, photorealistic results.",
    fr: "Le niveau le plus qualitatif d'Imagen 4, idéal pour des résultats détaillés et photoréalistes.",
    ar: "أعلى فئات الجودة في Imagen 4، الأمثل للنتائج التفصيلية والواقعية.",
  },
  "gemini-2.5-flash-image": {
    en: "A Gemini 2.5 Flash variant that supports image output alongside text.",
    fr: "Une variante de Gemini 2.5 Flash prenant en charge la sortie d'images en plus du texte.",
    ar: "نسخة من Gemini 2.5 Flash تدعم إخراج الصور إلى جانب النص.",
  },
  "gemini-3.1-flash-image-preview": {
    en: "Gemini 3.1 Flash with image generation, in early preview.",
    fr: "Gemini 3.1 Flash avec génération d'images, en avant-première.",
    ar: "Gemini 3.1 Flash مع توليد الصور، في إصدار تجريبي مبكّر.",
  },
  "gemini-3-pro-image-preview": {
    en: "Pro-tier Gemini 3 with image input and image generation support.",
    fr: "Gemini 3 de niveau Pro, avec entrée d'images et génération d'images.",
    ar: "Gemini 3 من الفئة الاحترافية مع دعم إدخال الصور وتوليدها.",
  },
  "recraftv3_vector": {
    en: "Turns existing images or sketches into clean, scalable vector graphics from a text prompt.",
    fr: "Transforme des images ou des croquis existants en graphiques vectoriels nets et redimensionnables à partir d'une instruction textuelle.",
    ar: "يحوّل الصور أو الرسومات الموجودة إلى رسومات متجهية نظيفة وقابلة للتكبير انطلاقًا من وصف نصّي.",
  },
  "recraftv4_1": {
    en: "Generates highly detailed, pixel-based images from scratch using only a text description.",
    fr: "Génère des images matricielles très détaillées à partir de zéro, à l'aide d'une simple description textuelle.",
    ar: "يُولّد صورًا نقطية عالية التفصيل من الصفر باستخدام وصف نصّي فقط.",
  },
  "recraftv4_1_vector": {
    en: "Creates resolution-independent vector illustrations and icons entirely from text prompts.",
    fr: "Crée des illustrations et icônes vectorielles indépendantes de la résolution, entièrement à partir d'instructions textuelles.",
    ar: "يُنشئ رسومًا وأيقونات متجهية مستقلة عن الدقة بالكامل من الأوصاف النصية.",
  },
  "ideogram-v3-replace-background": {
    en: "Replaces an image's background from a prompt with Ideogram 3.0, keeping the foreground subject intact.",
    fr: "Remplace l'arrière-plan d'une image à partir d'une instruction avec Ideogram 3.0, en conservant le sujet au premier plan.",
    ar: "يستبدل خلفية الصورة وفق وصف نصّي باستخدام Ideogram 3.0 مع الحفاظ على العنصر الأمامي.",
  },
};

/**
 * Returns the localized description for a model slug, or undefined when the
 * model is not in the map (callers should fall back to a generic line).
 */
export function getModelDescription(id: string | undefined, language: Language): string | undefined {
  if (!id) return undefined;
  return MODEL_DESCRIPTIONS[id]?.[language];
}
