"""In-code, versioned Pack catalog (typed definitions).

Per the brief this is NOT a DB table and NOT admin-editable: packs change rarely
and ship with a deploy. A pack declares a *capability* (resolved to a live model
at request time) - it never hardcodes a model.

i18n NOTE: the Arabic-first sector (`arabic`) uses the design's exact trilingual
wording. For the six non-Arabic sectors the fr/ar strings are FUNCTIONAL DRAFTS
(owner to finalize local phrasing) - see PACKS_FEATURE_DESIGN.md S1.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

# {"en": ..., "fr": ..., "ar": ...}
I18n = Dict[str, str]

LANGS = ("ar", "en", "fr")
DEFAULT_LANG = "ar"


def pick(i18n: Optional[I18n], lang: str) -> str:
    """Localized value with graceful fallback (lang -> en -> any)."""
    if not i18n:
        return ""
    return i18n.get(lang) or i18n.get("en") or next(iter(i18n.values()), "")


@dataclass(frozen=True)
class SlotOption:
    value: str
    label_i18n: I18n


@dataclass(frozen=True)
class Slot:
    key: str                       # matches {{key}} in prompt_template
    type: str                      # "text" | "select" | "image_ref"
    label_i18n: I18n
    required: bool = False
    options: List[SlotOption] = field(default_factory=list)   # type=select only
    placeholder_i18n: Optional[I18n] = None                   # type=text only
    multiline: bool = False        # type=text -> render as a textarea (free prompt)


@dataclass(frozen=True)
class Variant:
    """A selectable mockup/scene preset under a pack. Picking one opens the studio
    with ``scene`` pre-filled into the (editable) prompt and this example shown."""
    id: str
    title_i18n: I18n
    scene: str                     # base prompt text seeded into the studio
    thumbnail_url: str = ""
    hero_example_url: str = ""
    # Editable example that pre-fills the studio composer for THIS mockup (falls
    # back to the pack-level example when not set). User-facing text, not the scene.
    example_i18n: Optional[I18n] = None


@dataclass(frozen=True)
class Pack:
    id: str
    sector: str
    order: int
    capability: str                # photoreal | edit-from-reference | text-in-image | vector-graphic | calligraphy
    prompt_template: str
    title_i18n: I18n
    description_i18n: I18n          # the one-line "promise"
    # "structured" = guided fill-in-the-blanks slots; "freeform" = the user writes
    # a free prompt (and/or supplies an image) and the model generates from it.
    kind: str = "structured"
    slots: List[Slot] = field(default_factory=list)
    # Optional mockup/scene presets. When present, the gallery card opens a
    # variant picker first, then the studio seeded by the chosen variant.
    variants: List["Variant"] = field(default_factory=list)
    aspect_ratios: List[str] = field(default_factory=lambda: ["1:1"])
    default_n: int = 1
    requires_image_input: bool = False
    # Fallback prompt for freeform packs when the user supplies only an image.
    default_prompt: str = ""
    enabled: bool = True
    tags: List[str] = field(default_factory=list)
    thumbnail_url: str = ""
    hero_example_url: str = ""
    # Editable example that pre-fills the studio composer (pack-level default; a
    # variant's own example_i18n overrides it). User-facing text, not the scene.
    example_i18n: Optional[I18n] = None


# --------------------------------------------------------------------------
# Compact constructors
# --------------------------------------------------------------------------
def i18n(en: str, fr: str, ar: str) -> I18n:
    return {"en": en, "fr": fr, "ar": ar}


def opt(value: str, en: str, fr: str, ar: str) -> SlotOption:
    return SlotOption(value, i18n(en, fr, ar))


def text_slot(key: str, label: I18n, required: bool = False, placeholder: Optional[I18n] = None,
              multiline: bool = False) -> Slot:
    return Slot(key=key, type="text", label_i18n=label, required=required,
                placeholder_i18n=placeholder, multiline=multiline)


def prompt_slot(label: I18n, placeholder: Optional[I18n] = None, required: bool = True) -> Slot:
    """The single free-prompt field of a freeform pack (rendered as a textarea)."""
    return Slot(key="prompt", type="text", label_i18n=label, required=required,
                placeholder_i18n=placeholder, multiline=True)


def select_slot(key: str, label: I18n, options: List[SlotOption], required: bool = False) -> Slot:
    return Slot(key=key, type="select", label_i18n=label, required=required, options=options)


# Reusable option groups -----------------------------------------------------
PALETTE_OPTS = [
    opt("pastel", "pastel", "pastel", "باستيل"),
    opt("earthy", "earthy", "terreux", "ترابي"),
    opt("vibrant", "vibrant", "vif", "زاهي"),
    opt("monochrome", "monochrome", "monochrome", "أحادي اللون"),
]


# Product-in-scene library: real photographed scenes the uploaded product is
# composited into (the scene image is also sent to the model as reference #1).
def _scene(slug: str, en: str, fr: str, ar: str, setting: str, fname: str) -> Variant:
    url = f"/mockups/ecommerce/lifestyle-in-use/{fname}"
    return Variant(
        slug, i18n(en, fr, ar),
        f"the uploaded product placed naturally in {setting}, realistic scale, "
        f"matching the scene's light, shadows and perspective, photorealistic, high detail",
        url, url,
    )


_LIFESTYLE_VARIANTS: List[Variant] = [
    _scene("white-pedestals", "White pedestals", "Socles blancs", "منصات بيضاء", "a minimalist arrangement of white pedestal risers under soft studio light", "scene-01.jpg"),
    _scene("mint-backdrop", "Mint backdrop", "Fond menthe", "خلفية نعناعية", "a cream tabletop against a mint-green wall with hard directional sunlight and crisp shadows", "scene-02.jpg"),
    _scene("bright-desk-plant", "Bright desk", "Bureau lumineux", "مكتب مضيء", "a bright white desk with a small green plant and clean natural light", "scene-03.jpg"),
    _scene("navy-lounge", "Navy lounge", "Salon bleu nuit", "صالة كحلية", "a navy-blue lounge corner with a mustard chair and plants, warm ambient light", "scene-04.jpg"),
    _scene("blue-knit", "Blue knit", "Maille bleue", "حياكة زرقاء", "a soft textured blue knit fabric surface in gentle daylight", "scene-05.jpg"),
    _scene("moody-cafe-wood", "Moody cafe", "Café feutré", "مقهى هادئ", "a dark moody wooden cafe table with blurred seating behind and low warm light", "scene-06.jpg"),
    _scene("clean-white", "Clean white", "Blanc épuré", "أبيض نظيف", "a clean seamless white surface under even soft studio light", "scene-07.jpg"),
    _scene("rustic-warm-props", "Rustic wood", "Bois rustique", "خشب ريفي", "a dark rustic wooden table styled with warm brass props and a patterned rug, moody light", "scene-08.jpg"),
    _scene("marble-kitchen", "Marble kitchen", "Cuisine marbre", "مطبخ رخامي", "a marble kitchen countertop beside a black faucet in soft daylight", "scene-09.jpg"),
    _scene("grey-wood-rod", "Grey & wood", "Gris et bois", "رمادي وخشب", "a smooth grey surface with a pale wooden rod accent under soft studio light", "scene-10.jpg"),
    _scene("rust-linen", "Rust linen", "Lin terracotta", "كتان قرميدي", "softly draped rust terracotta linen fabric with gentle shadows", "scene-11.jpg"),
    _scene("bistro-brick", "Bistro table", "Table bistrot", "طاولة بسترو", "a round glass bistro table against an exposed brick wall in warm cafe light", "scene-12.jpg"),
    _scene("marble-cafe", "Marble cafe", "Café marbre", "مقهى رخامي", "a white marble cafe tabletop in bright natural light", "scene-13.jpg"),
    _scene("dappled-shadows", "Dappled light", "Lumière tamisée", "ضوء متلألئ", "a white surface washed with dappled leaf shadows from sunlight", "scene-14.jpg"),
    _scene("dark-surface", "Dark surface", "Surface sombre", "سطح داكن", "a dark textured surface under dramatic low-key lighting", "scene-15.jpg"),
    _scene("white-vase-scene", "White vase", "Vase blanc", "مزهرية بيضاء", "a clean white surface with a white vase and a soft pink flower, minimal light", "scene-16.jpg"),
    _scene("yellow-studio", "Yellow studio", "Studio jaune", "استوديو أصفر", "a bold yellow studio backdrop with a soft shadow and vibrant light", "scene-17.jpg"),
    _scene("dark-wood-flatlay", "Dark wood flatlay", "Bois foncé à plat", "تنسيق خشبي داكن", "a dark wooden table flatlay with coffee and natural props, moody light", "scene-18.jpg"),
    _scene("red-woodgrain", "Red wood grain", "Bois rouge", "خشب أحمر", "a textured red cracked-wood cross-section surface under dramatic light", "scene-19.jpg"),
    _scene("grey-accessories", "Grey accessories", "Accessoires gris", "إكسسوارات رمادية", "a soft grey surface styled with a felt hat and leather goods, soft light", "scene-20.jpg"),
    _scene("charcoal-linen", "Charcoal linen", "Lin anthracite", "كتان فحمي", "draped charcoal-grey linen with dried flowers under moody soft light", "scene-21.jpg"),
    _scene("minimal-white-desk", "White desk", "Bureau blanc", "مكتب أبيض", "a minimal bright white desk surface under even light", "scene-22.jpg"),
    _scene("soft-white-drape", "White drape", "Drapé blanc", "قماش أبيض", "soft draped white fabric under gentle studio light", "scene-23.jpg"),
    _scene("wood-reading-desk", "Reading desk", "Bureau lecture", "مكتب قراءة", "a wooden desk with an open book and warm props in cozy daylight", "scene-24.jpg"),
    _scene("taupe-linen", "Taupe linen", "Lin taupe", "كتان بُني فاتح", "softly draped taupe-brown linen fabric with gentle shadows", "scene-25.jpg"),
    _scene("soft-white-fabric", "Soft white fabric", "Tissu blanc doux", "قماش أبيض ناعم", "crumpled soft white fabric in airy diffused light", "scene-26.jpg"),
    _scene("beach-seaside", "Beach sand", "Sable de plage", "رمال الشاطئ", "sunny beach sand by the seaside in bright natural light", "scene-27.jpg"),
    _scene("peach-leaf-shadow", "Peach backdrop", "Fond pêche", "خلفية خوخية", "a peachy-pink backdrop with palm-leaf shadows in warm light", "scene-28.jpg"),
    _scene("yellow-wall-props", "Yellow wall", "Mur jaune", "جدار أصفر", "a warm yellow wall with a concrete vase and linen props in natural light", "scene-29.jpg"),
    _scene("pink-flatlay", "Pink flatlay", "À plat rose", "تنسيق وردي", "a pink desk flatlay with stationery and soft props in bright light", "scene-30.jpg"),
    _scene("grey-gadget-flatlay", "Gadget flatlay", "À plat tech", "تنسيق إلكتروني", "a grey flatlay scene with gadgets and casual props in soft daylight", "scene-31.jpg"),
    _scene("lilac-gradient", "Lilac gradient", "Dégradé lilas", "تدرج بنفسجي", "a soft blue-to-lilac gradient studio backdrop in clean light", "scene-32.jpg"),
    _scene("grey-carpet", "Grey carpet", "Tapis gris", "سجاد رمادي", "a modern grey carpet surface with a subtle pattern under soft light", "scene-33.jpg"),
    _scene("fresh-board-herbs", "Fresh board", "Planche fraîche", "لوح طازج", "a rustic wooden board styled with fresh herbs and fruit in natural light", "scene-34.jpg"),
    _scene("autumn-vase-wood", "Autumn table", "Table automne", "طاولة خريفية", "a wooden table with a terracotta vase of dried flowers in warm light", "scene-35.jpg"),
    _scene("dark-moody-flatlay", "Moody flatlay", "À plat sombre", "تنسيق داكن", "a dark moody flatlay with a candle and book under low-key light", "scene-36.jpg"),
    _scene("dark-bakery", "Dark bakery", "Boulangerie sombre", "مخبز داكن", "a dark rustic surface with baked goods under moody warm light", "scene-37.jpg"),
    _scene("designer-wall", "Designer wall", "Mur design", "جدار مُصمَّم", "a dramatic dark wall with circular accent lights, low-key light", "scene-38.jpg"),
    _scene("cozy-wood-flatlay", "Cozy flatlay", "À plat cosy", "تنسيق دافئ", "a cozy wooden desk flatlay with a book, scarf and coffee in warm light", "scene-39.jpg"),
    _scene("white-tropical", "White & leaves", "Blanc et feuilles", "أبيض وأوراق", "a white desk with tropical plant leaves in bright clean light", "scene-40.jpg"),
    _scene("moody-living-room", "Moody living room", "Salon feutré", "غرفة معيشة هادئة", "a dark moody living room with a grey sofa in ambient light", "scene-41.jpg"),
    _scene("marble-gold-bath", "Marble & gold", "Marbre et or", "رخام وذهب", "a marble bathroom counter with a gold faucet in soft light", "scene-42.jpg"),
    _scene("slate-wood-shelf", "Slate shelf", "Étagère ardoise", "رف حجري", "a dark slate wall with a wooden floating shelf under moody light", "scene-43.jpg"),
    _scene("sunlit-wood-desk", "Sunlit desk", "Bureau ensoleillé", "مكتب مشمس", "a wooden desk with a task lamp and a small plant in warm sunlight", "scene-44.jpg"),
    _scene("wood-bath-shelf", "Bathroom shelf", "Étagère bain", "رف الحمّام", "a wooden bathroom shelf with candles and towels in soft light", "scene-45.jpg"),
    _scene("dark-jewelry-display", "Jewelry display", "Présentoir bijoux", "عرض مجوهرات", "a dark backdrop styled with jewelry and white blossoms under focused light", "scene-46.jpg"),
    _scene("grey-concrete", "Concrete surface", "Surface béton", "سطح إسمنتي", "a raw grey concrete surface in even neutral light", "scene-47.jpg"),
    _scene("burgundy-fabric", "Burgundy fabric", "Tissu bordeaux", "قماش عنابي", "deep burgundy draped fabric under elegant soft light", "scene-48.jpg"),
    _scene("pink-rustic-wood", "Pink wood", "Bois rose", "خشب وردي", "a rustic pink-toned wooden backdrop in soft warm light", "scene-49.jpg"),
    _scene("weathered-blue-wood", "Blue wood", "Bois bleu", "خشب أزرق", "a weathered blue-painted wood backdrop in soft daylight", "scene-50.jpg"),
    _scene("quilted-silver", "Silver satin", "Satin argenté", "ساتان فضي", "a quilted silver satin surface with soft reflective light", "scene-51.jpg"),
    _scene("bright-console", "Bright console", "Console claire", "كونسول مضيء", "a bright console table against a white wall with flowers in airy light", "scene-52.jpg"),
    _scene("water-splash", "Water splash", "Éclaboussure", "رذاذ ماء", "a fresh dynamic water splash on a white background in crisp light", "scene-53.jpg"),
    _scene("concrete-interior", "Concrete interior", "Intérieur béton", "داخلية إسمنتية", "a modern grey concrete interior setting with architectural light", "scene-54.jpg"),
    _scene("wood-slice-coffee", "Wood slice", "Rondin de bois", "شريحة خشب", "a natural wood-slice surface with coffee and a plant in warm light", "scene-55.jpg"),
    _scene("wood-floor-topdown", "Wood floor", "Sol en bois", "أرضية خشبية", "a top-down wooden floor scene in natural daylight", "scene-56.jpg"),
    _scene("dark-smoke", "Dark smoke", "Fumée sombre", "دخان داكن", "a dark smoky atmospheric background with a dramatic spotlight", "scene-57.jpg"),
    _scene("modern-bathroom", "Modern bathroom", "Salle de bain moderne", "حمام عصري", "a clean modern bathroom vanity scene in bright soft light", "scene-58.jpg"),
    _scene("cafe-corner-wood", "Cafe corner", "Coin café", "ركن المقهى", "a warm wooden cafe corner with a table by a window in daylight", "scene-59.jpg"),
    _scene("dusty-pink-fabric", "Dusty pink", "Rose poudré", "وردي باهت", "a dusty-pink backdrop with flowing soft fabric in gentle light", "scene-60.jpg"),
    _scene("moody-blue", "Moody blue", "Bleu feutré", "أزرق هادئ", "a moody blue-grey scene with a dramatic directional shadow, low-key light", "scene-61.jpg"),
    _scene("white-florals", "White florals", "Blanc fleuri", "أبيض مُزهر", "a white surface styled with yellow flowers in fresh bright light", "scene-62.jpg"),
    _scene("teal-pedestal", "Teal pedestal", "Socle canard", "منصة فيروزية", "a teal backdrop with a raised pedestal under clean studio light", "scene-63.jpg"),
    # --- Podiums & pedestals (added 2026-07) ---
    _scene("copper-hands", "Copper hands", "Mains en cuivre", "أيادٍ نحاسية", "the cupped palms of two glossy copper metallic sculpture hands on a dark charcoal background, dramatic studio light", "scene-64.jpg"),
    _scene("green-spotlight-podium", "Green podium", "Podium vert", "منصة خضراء", "the center of a green cylindrical podium beneath a round hanging spotlight, deep green backdrop with soft drapery, moody editorial light", "scene-65.jpg"),
    _scene("beige-slab-pedestal", "Beige slab", "Socle beige", "منصة بيج", "the center of a floating beige rectangular slab pedestal against a warm beige background, soft minimal shadow", "scene-66.jpg"),
    _scene("black-copper-podium", "Black & copper", "Noir et cuivre", "أسود ونحاسي", "the center of a glossy black round podium with a copper rim in a two-tone grey corner, decorative copper and black spheres nearby, soft studio light", "scene-67.jpg"),
    _scene("blue-glass-podium", "Blue glass podium", "Podium verre bleu", "منصة زجاج زرقاء", "the center of a translucent blue glass disc podium against a soft pale blue-grey background, clean glossy reflection", "scene-68.jpg"),
    _scene("wood-botanical-podium", "Botanical podium", "Podium botanique", "منصة نباتية", "the center of a round wooden podium surrounded by pebbles, smooth stones and fresh green leaves, warm beige stone wall backdrop, natural spa mood", "scene-69.jpg"),
    _scene("tropical-beach-table", "Tropical beach", "Plage tropicale", "شاطئ استوائي", "the foreground of a stone tabletop with a blurred tropical palm beach and golden-hour sunset ocean behind, warm summer light", "scene-70.jpg"),
    _scene("warm-lamp-podium", "Warm lamp podium", "Podium lampe chaude", "منصة بإضاءة دافئة", "the center of a glowing cream cylindrical podium in a warm terracotta-brown niche lit by a hanging pendant lamp, cozy warm ambiance", "scene-71.jpg"),
    _scene("backlit-navy-podium", "Backlit navy", "Bleu rétroéclairé", "كحلي مضيء", "the center of a dark navy round podium with a warm orange backlight glowing underneath, moody deep-blue room, cinematic light", "scene-72.jpg"),
    _scene("smoke-podium", "Smoke podium", "Podium fumée", "منصة دخانية", "the center of a round podium with a white top surrounded by swirling white smoke on a black background, dramatic mysterious mood", "scene-73.jpg"),
    _scene("draped-wood-podium", "Draped wood", "Bois drapé", "خشب بقماش", "the center of a round wooden podium draped with flowing white fabric, warm beige wall with soft leaf shadows and green plants, bright airy daylight", "scene-74.jpg"),
]


def _badge(slug: str, en: str, fr: str, ar: str, style: str, fname: str) -> Variant:
    url = f"/mockups/ecommerce/sale-promo-badge/{fname}"
    return Variant(
        slug, i18n(en, fr, ar),
        f"an eye-catching sale graphic of the uploaded product with {style}, "
        f"bold headline and discount percentage, matching the reference badge's shape, style and colors, "
        f"clean legible typography, high detail",
        url, url,
    )


_BADGE_VARIANTS: List[Variant] = [
    _badge("purple-arrival-shield", "Purple 'new arrival'", "Écusson violet", "درع بنفسجي", "a purple-and-gold 'new arrival' shield badge on a dark backdrop", "badge-01.png"),
    _badge("teal-round", "Teal round badge", "Badge rond canard", "شارة فيروزية دائرية", "a glossy teal circular discount badge with a metallic rim", "badge-02.png"),
    _badge("orange-ribbon", "Orange 3D ribbon", "Ruban orange 3D", "شريط برتقالي", "a bold 3D orange ribbon-banner discount badge", "badge-03.png"),
    _badge("yellow-starburst", "Yellow starburst", "Étoile jaune", "نجمة صفراء", "a vibrant yellow starburst discount badge", "badge-04.png"),
    _badge("green-price-tag", "Green price tag", "Étiquette verte", "بطاقة سعر خضراء", "a fresh green price-tag discount badge with a string", "badge-05.png"),
    _badge("deep-red-seal", "Deep-red seal", "Sceau rouge", "ختم أحمر", "a deep-red circular embossed seal discount badge", "badge-06.png"),
    _badge("blue-star", "Blue star badge", "Badge étoile bleu", "شارة نجمة زرقاء", "a light-blue star-accent discount badge, glossy", "badge-07.png"),
    _badge("blue-hexagon", "Blue hexagon", "Hexagone bleu", "سداسي أزرق", "a bold blue hexagonal discount badge, 3D", "badge-08.png"),
    _badge("silver-arrival-plaque", "Silver 'new arrival'", "Plaque argentée", "لوحة فضية", "a brushed-silver 'new arrival' metallic plaque on a dark backdrop", "badge-09.png"),
    _badge("blue-arrival-ribbon", "Blue 'new arrival'", "Ruban bleu", "شريط أزرق", "a blue 'new arrival' shield-and-ribbon badge", "badge-10.png"),
    _badge("flash-sale-burst", "Flash-sale burst", "Éclat flash", "وميض التخفيضات", "a colorful geometric flash-sale burst discount badge", "badge-11.png"),
    _badge("gold-special-label", "Gold special sale", "Étiquette or", "بطاقة ذهبية", "an elegant gold-and-dark 'special sale' rectangular label badge", "badge-12.png"),
    _badge("teal-outline-tag", "Teal outline tag", "Étiquette contour", "بطاقة محددة", "a minimal teal outline 'limited time' tag discount badge", "badge-13.png"),
    _badge("geometric-hanging-tag", "Geometric hang tag", "Étiquette suspendue", "بطاقة معلقة", "a colorful geometric hanging price-tag discount badge", "badge-14.png"),
    _badge("black-gold-luxury", "Black & gold luxury", "Luxe noir et or", "فاخر أسود وذهبي", "a luxury black-and-gold hexagonal discount tag badge", "badge-15.png"),
    _badge("red-sale-shield", "Red sale shield", "Écusson rouge", "درع تخفيضات أحمر", "a bold red 'sale percent off' shield badge", "badge-16.png"),
    _badge("red-percent-shield", "Red percent-off", "Bouclier rouge", "شارة نسبة حمراء", "a bright red 'percent off' shield badge, high contrast", "badge-17.png"),
]


# Packaging / label library: real photographed packages the uploaded label or
# design is applied onto (the mockup image is also sent to the model as
# reference #1, so its shape, perspective and lighting are reproduced).
def _pkg(slug: str, en: str, fr: str, ar: str, surface: str, fname: str) -> Variant:
    url = f"/mockups/ecommerce/packaging-label/{fname}"
    return Variant(
        slug, i18n(en, fr, ar),
        f"the uploaded label or design applied to {surface}, accurate perspective, "
        f"curvature and lighting, photorealistic, high detail",
        url, url,
    )


_PACKAGING_VARIANTS: List[Variant] = [
    _pkg("bottle", "Bottle", "Flacon", "زجاجة", "a realistic glass or plastic bottle held in hand, accurate curvature", "bottle.jpg"),
    _pkg("jar", "Jar", "Pot", "برطمان", "a realistic amber cosmetic jar with a blank front label", "jar.jpg"),
    _pkg("pouch", "Pouch", "Sachet", "كيس", "a realistic kraft stand-up pouch with accurate folds", "pouch.jpg"),
    _pkg("box", "Box", "Boîte", "علبة", "a realistic matte product box", "box.jpg"),
    _pkg("presentation-box", "Presentation box", "Coffret présentation", "علبة عرض", "a premium presentation box held open in hand", "scene-01.jpg"),
    _pkg("kraft-bag", "Kraft bag", "Sac kraft", "كيس كرافت", "a kraft paper shopping bag on a light surface", "scene-02.jpg"),
    _pkg("honey-jar", "Honey jar", "Pot de miel", "برطمان عسل", "a glass honey jar with a cloth lid on a bold yellow backdrop", "scene-03.jpg"),
    _pkg("rigid-box-set", "Rigid box set", "Coffrets rigides", "علب صلبة", "a set of premium rigid boxes on a soft backdrop", "scene-04.jpg"),
    _pkg("navy-gift-box", "Navy gift box", "Coffret bleu nuit", "علبة كحلية", "elegant navy and gold rigid gift boxes", "scene-05.jpg"),
    _pkg("holiday-set", "Holiday set", "Coffret fêtes", "علبة أعياد", "a holiday gift box set on a festive red backdrop", "scene-06.jpg"),
    _pkg("vanity-shelf", "Vanity shelf", "Étagère beauté", "رف تجميل", "skincare bottles styled on a bright vanity shelf", "scene-07.jpg"),
    _pkg("kraft-gift-box", "Kraft gift box", "Coffret kraft", "علبة كرافت", "an open kraft gift box on a wooden surface", "scene-08.jpg"),
    _pkg("magnetic-box", "Magnetic box", "Boîte magnétique", "علبة مغناطيسية", "a magnetic-closure rigid box, shown open and closed", "scene-09.jpg"),
    _pkg("glass-bottles", "Glass bottles", "Bouteilles en verre", "زجاجات زجاجية", "green glass bottles on a dark reflective surface", "scene-10.jpg"),
    _pkg("jewelry-box", "Jewelry box", "Écrin", "علبة مجوهرات", "a hinged rose-toned jewelry presentation box", "scene-11.jpg"),
    _pkg("cosmetic-tubes", "Cosmetic tubes", "Tubes cosmétiques", "أنابيب تجميل", "cosmetic tubes resting beside a plant in soft daylight", "scene-12.jpg"),
    _pkg("copper-tin", "Copper tin", "Boîte cuivrée", "علبة نحاسية", "a copper tin canister on a rustic wooden surface", "scene-13.jpg"),
    _pkg("green-box-set", "Green box set", "Coffrets verts", "علب خضراء", "a flat lay of matte green product boxes", "scene-14.jpg"),
    _pkg("blush-box", "Blush box", "Boîte rose", "علبة وردية", "an open blush-pink product box in soft sunlight", "scene-15.jpg"),
    _pkg("black-boxes", "Black boxes", "Boîtes noires", "علب سوداء", "small black gift boxes on a clean white surface", "scene-16.jpg"),
    _pkg("pump-bottles", "Pump bottles", "Flacons pompe", "زجاجات مضخة", "a set of skincare pump bottles on a stone surface", "scene-17.jpg"),
    _pkg("chocolate-box", "Chocolate box", "Boîte de chocolats", "علبة شوكولاتة", "an open confectionery gift box", "scene-18.jpg"),
    _pkg("skincare-set", "Skincare set", "Set de soin", "طقم عناية", "a skincare set of a jar and pump bottles on a dark surface", "scene-19.jpg"),
    _pkg("windowsill-bottle", "Windowsill bottle", "Bouteille fenêtre", "زجاجة نافذة", "a bottle on a sunny windowsill overlooking a landscape", "scene-20.jpg"),
    _pkg("drink-can", "Drink can", "Canette", "علبة مشروب", "a tall aluminium drink can", "scene-21.jpg"),
    _pkg("white-box", "White box", "Boîte blanche", "علبة بيضاء", "a white product box held in hand beside a plant", "scene-22.jpg"),
    _pkg("rustic-jar", "Rustic jar", "Pot rustique", "برطمان ريفي", "a rustic jar with a cloth lid on a wooden stump", "scene-23.jpg"),
    _pkg("chocolate-bar", "Chocolate bar", "Barre chocolatée", "لوح شوكولاتة", "a wrapped chocolate bar on dark earthy ground", "scene-24.jpg"),
    _pkg("fabric-pouch", "Fabric pouch", "Pochette tissu", "كيس قماشي", "a white drawstring fabric pouch on a clean surface", "scene-25.jpg"),
    _pkg("kraft-mailer", "Kraft mailer", "Boîte kraft", "صندوق كرافت", "a kraft mailer box held in both hands", "scene-26.jpg"),
    _pkg("kraft-tube", "Kraft tube", "Tube kraft", "أنبوب كرافت", "kraft tubes and boxes balanced on a pedestal", "scene-27.jpg"),
]


# Seasonal-campaign library: festive occasion scenes the uploaded product is
# styled into (the scene image is also sent to the model as reference #1).
def _seasonal(slug: str, en: str, fr: str, ar: str, scene: str, fname: str) -> Variant:
    url = f"/mockups/ecommerce/seasonal-campaign/{fname}"
    return Variant(
        slug, i18n(en, fr, ar),
        f"the uploaded product styled in {scene}, photorealistic, high detail",
        url, url,
    )


_SEASONAL_VARIANTS: List[Variant] = [
    _seasonal("ramadan", "Ramadan", "Ramadan", "رمضان", "a festive Ramadan scene with a glowing lantern and warm decorative props in soft warm light", "ramadan.jpg"),
    _seasonal("eid", "Eid", "Aïd", "العيد", "an elegant Eid scene with traditional maamoul sweets and coffee in warm light", "eid.jpg"),
    _seasonal("back-to-school", "Back to school", "Rentrée", "العودة للمدرسة", "a bright back-to-school desk scene with a notebook and coffee in clean daylight", "back-to-school.jpg"),
    _seasonal("new-year", "New Year", "Nouvel An", "رأس السنة", "an elegant New Year table setting with a gold-rimmed emerald plate in soft moody light", "new-year.jpg"),
    _seasonal("summer-sale", "Summer sale", "Soldes d'été", "تخفيضات الصيف", "a sunny summer beach scene with a parasol by the sea in bright daylight", "summer-sale.jpg"),
    _seasonal("ramadan-lights", "Ramadan lights", "Lumières de Ramadan", "أضواء رمضان", "a festive Ramadan scene lit by glowing crescent-and-mosque string lights in the dark", "scene-01.jpg"),
    _seasonal("spring-blossom", "Spring blossom", "Fleur de printemps", "زهر الربيع", "a minimal spring scene with a delicate blossoming twig on a white plate in bright soft light", "scene-02.jpg"),
    _seasonal("spring-tulips", "Spring tulips", "Tulipes de printemps", "زهور الربيع", "a soft spring flat lay of fresh tulips and scattered petals in bright natural light", "scene-03.jpg"),
    _seasonal("greeting-card", "Greeting card", "Carte de vœux", "بطاقة تهنئة", "a warm greeting-card moment on a soft pink surface in gentle light", "scene-04.jpg"),
    _seasonal("spring-frame", "Spring frame", "Cadre printanier", "إطار ربيعي", "a pastel-blue spring backdrop with a fresh floral photo frame in airy light", "scene-05.jpg"),
    _seasonal("autumn-tray", "Autumn tray", "Plateau d'automne", "صينية الخريف", "a warm autumn tray of fallen leaves and dried flowers in golden light", "scene-06.jpg"),
    _seasonal("fresh-greenery", "Fresh greenery", "Verdure fraîche", "خضرة طازجة", "a fresh spring flat lay of green leaves on white linen in bright daylight", "scene-07.jpg"),
    _seasonal("wrapped-gift", "Wrapped gift", "Cadeau emballé", "هدية مغلفة", "a soft gift-wrapping scene with fabric, ribbon and eucalyptus in gentle light", "scene-08.jpg"),
    _seasonal("green-wall", "Green wall", "Mur végétal", "جدار أخضر", "a lush green foliage wall backdrop in even natural light", "scene-09.jpg"),
    _seasonal("moroccan-tea", "Moroccan tea", "Thé marocain", "شاي مغربي", "a vibrant Moroccan tea setting with patterned glasses on a tray in warm light", "scene-10.jpg"),
    _seasonal("floral-wreath", "Floral wreath", "Couronne florale", "إكليل زهور", "a spring floral wreath frame on a white surface in bright soft light", "scene-11.jpg"),
    _seasonal("spring-blossoms", "Spring blossoms", "Fleurs de printemps", "أزهار الربيع", "white blossom branches framing a soft pastel-blue backdrop in airy light", "scene-12.jpg"),
    _seasonal("mothers-day", "Mother's day", "Fête des mères", "عيد الأم", "a Mother's Day scene with purple flowers and a greeting card in soft bright light", "scene-13.jpg"),
    _seasonal("eid-mubarak", "Eid Mubarak", "Aïd Moubarak", "عيد مبارك", "an elegant Eid Mubarak table with ornate cups and festive props in warm light", "scene-14.jpg"),
    _seasonal("autumn-board", "Autumn board", "Planche d'automne", "طاولة الخريف", "a rustic autumn wooden board with seasonal fruit and flowers in warm golden light", "scene-15.jpg"),
    _seasonal("orange-sale", "Orange sale", "Promo orange", "تخفيضات برتقالية", "a bold orange sale backdrop with graphic black props under punchy studio light", "scene-16.jpg"),
    _seasonal("mediterranean", "Mediterranean", "Méditerranée", "البحر المتوسط", "a sunny Mediterranean poolside with blue-and-white architecture in bright daylight", "scene-17.jpg"),
    _seasonal("lilac-bloom", "Lilac bloom", "Floraison lilas", "أزهار الليلك", "a soft spring scene with fresh lilac blooms on a pedestal in gentle light", "scene-18.jpg"),
    _seasonal("ramadan-iftar", "Ramadan iftar", "Iftar de Ramadan", "إفطار رمضان", "an elegant Ramadan iftar setting with dates and tea on dark marble in moody warm light", "scene-19.jpg"),
    _seasonal("chocolate-gifts", "Chocolate gifts", "Chocolats cadeaux", "شوكولاتة هدايا", "a romantic arrangement of gift chocolates on white in soft light", "scene-20.jpg"),
    _seasonal("greek-village", "Greek village", "Village grec", "قرية يونانية", "a bright summer Greek village of white-and-blue houses in sunny daylight", "scene-21.jpg"),
    _seasonal("birthday", "Birthday", "Anniversaire", "عيد ميلاد", "a golden birthday celebration with a cake on a tiered stand and balloons in glamorous light", "scene-22.jpg"),
    _seasonal("warm-coffee", "Warm coffee", "Café chaud", "قهوة دافئة", "a cozy autumn scene with a steaming coffee mug in warm low light", "scene-23.jpg"),
    _seasonal("gift-breakfast", "Gift breakfast", "Petit-déjeuner cadeau", "فطور احتفالي", "a bright celebratory breakfast with gift boxes and paper flowers in fresh daylight", "scene-24.jpg"),
    _seasonal("wildflowers", "Wildflowers", "Fleurs sauvages", "أزهار برية", "a vivid spring meadow of colorful wildflowers in bright natural light", "scene-25.jpg"),
    _seasonal("red-sale", "Red sale", "Promo rouge", "تخفيضات حمراء", "a bold red sale backdrop with a sleek black gift box under dramatic studio light", "scene-26.jpg"),
    _seasonal("red-gift", "Red gift", "Cadeau rouge", "هدية حمراء", "a festive red backdrop with an elegant black gift box in dramatic light", "scene-27.jpg"),
    _seasonal("christmas", "Christmas", "Noël", "عيد الميلاد", "a decorated Christmas tree with wrapped gifts and warm glowing lights", "scene-28.jpg"),
    _seasonal("ramadan-card", "Ramadan card", "Carte de Ramadan", "بطاقة رمضان", "a minimal Ramadan Mubarak greeting card on white in soft light", "scene-29.jpg"),
    _seasonal("ramadan-mubarak", "Ramadan Mubarak", "Ramadan Moubarak", "رمضان مبارك", "a clean Ramadan Mubarak crescent greeting card in soft light", "scene-30.jpg"),
    _seasonal("ramadan-table", "Ramadan table", "Table de Ramadan", "طاولة رمضان", "a cozy Ramadan restaurant table with crescent bunting decor in warm light", "scene-31.jpg"),
]


# Held / in-use library: candid lifestyle scenes where the uploaded product is
# held, worn, or being used by a person (the scene image is also sent to the
# model as reference #1).
def _held(slug: str, en: str, fr: str, ar: str, scene: str, fname: str) -> Variant:
    url = f"/mockups/ecommerce/held-in-use/{fname}"
    return Variant(
        slug, i18n(en, fr, ar),
        f"the uploaded product {scene}, photorealistic, candid, high detail",
        url, url,
    )


_HELD_VARIANTS: List[Variant] = [
    _held("in-hand", "In hand", "En main", "في اليد", "held naturally in a person's hand to show scale, soft studio light", "in-hand.jpg"),
    _held("being-worn", "Being worn", "Porté", "مُرتدى", "worn by a person in a relaxed pose, soft light", "being-worn.jpg"),
    _held("being-poured", "Being poured", "Versé", "يُسكب", "being poured in a candid dynamic moment, soft light", "being-poured.jpg"),
    _held("close-on-skin", "Close-up", "Gros plan", "لقطة قريبة", "held close and applied to the skin to show texture and scale, soft natural light", "close-on-skin.jpg"),
    _held("pump-bottle-gift", "Pump bottle", "Flacon pompe", "زجاجة مضخة", "held in hand above a bright gift box", "scene-01.jpg"),
    _held("coffee-pour", "Pouring coffee", "Café versé", "سكب القهوة", "poured into a cup in a cosy Scandinavian kitchen", "scene-02.jpg"),
    _held("phone-in-hand", "Phone in hand", "Téléphone en main", "هاتف في اليد", "held in one hand beside a laptop in a modern workspace", "scene-03.jpg"),
    _held("phone-desk", "Phone at desk", "Téléphone au bureau", "هاتف على المكتب", "held over a dark desk with earbuds, flat-lay workspace", "scene-04.jpg"),
    _held("booklet-desk", "Booklet in hand", "Livret en main", "كتيب في اليد", "held in both hands over a dark minimalist desk", "scene-05.jpg"),
    _held("box-pedestal", "Box on pedestal", "Boîte sur socle", "علبة على قاعدة", "placed by hand onto a bright pedestal", "scene-06.jpg"),
    _held("gadget-in-hand", "Gadget in hand", "Gadget en main", "جهاز في اليد", "a small device held in both hands in an urban setting", "scene-07.jpg"),
    _held("smartwatch-wrist", "Smartwatch on wrist", "Montre au poignet", "ساعة ذكية على المعصم", "worn on the wrist against a clean minimal background", "scene-08.jpg"),
    _held("necklace-autumn", "Necklace, autumn", "Collier, automne", "قلادة خريفية", "worn on a model in a warm autumn outdoor portrait", "scene-09.jpg"),
    _held("rings-closeup", "Rings close-up", "Bagues, gros plan", "خواتم عن قرب", "worn on the fingers in a moody close-up", "scene-10.jpg"),
    _held("gift-box-hands", "Gift box in hands", "Coffret en mains", "علبة هدية في اليدين", "held in both hands in an elegant gifting moment", "scene-11.jpg"),
    _held("honey-drizzle", "Honey drizzle", "Filet de miel", "تقطير العسل", "drizzled from a dipper into a bowl in bright daylight", "scene-12.jpg"),
    _held("coffee-cup-hand", "Coffee cup in hand", "Gobelet en main", "كوب قهوة في اليد", "held in one hand against a blue facade", "scene-13.jpg"),
    _held("showing-vial", "Showing to camera", "Présenté à la caméra", "عرض أمام الكاميرا", "held out toward the camera by a model", "scene-14.jpg"),
    _held("sunglasses-model", "Sunglasses on model", "Lunettes sur modèle", "نظارة على العارض", "worn by a model in a sunny street portrait", "scene-15.jpg"),
    _held("bracelet-wrist", "Bracelet on wrist", "Bracelet au poignet", "سوار على المعصم", "worn on the wrist against a soft neutral background", "scene-16.jpg"),
    _held("bracelet-minimal", "Minimal bracelet", "Bracelet minimal", "سوار بسيط", "worn on the wrist against dark clothing", "scene-17.jpg"),
    _held("sneakers-white", "White sneakers", "Baskets blanches", "حذاء أبيض", "worn on the feet while walking on a warm floor", "scene-18.jpg"),
    _held("sneakers-street", "Sneakers on street", "Baskets en rue", "حذاء في الشارع", "worn on the feet on city pavement", "scene-19.jpg"),
    _held("watch-wrist", "Watch on wrist", "Montre au poignet", "ساعة على المعصم", "worn on the wrist while adjusting a sleeve", "scene-20.jpg"),
    _held("opening-box", "Opening a box", "Ouverture d'une boîte", "فتح علبة", "an open box held in the hands revealing the product", "scene-21.jpg"),
    _held("tea-pour", "Tea being poured", "Thé versé", "سكب الشاي", "poured into a small glass in warm golden light", "scene-22.jpg"),
    _held("perfume-playful", "Perfume, playful", "Parfum, ludique", "عطر بلمسة مرحة", "held playfully to the face by a model", "scene-23.jpg"),
    _held("honey-garden", "Honey jar, garden", "Pot de miel, jardin", "برطمان عسل في الحديقة", "shown with a dipper among lavender in a garden", "scene-24.jpg"),
    _held("espresso-pour", "Espresso pour", "Espresso versé", "سكب الإسبريسو", "poured into a small cup on a dark surface", "scene-25.jpg"),
    _held("watch-bracelets", "Watch & bracelets", "Montre & bracelets", "ساعة وأساور", "worn on the wrist with bracelets, outdoors", "scene-26.jpg"),
    _held("ice-cream-cone", "Ice cream cone", "Cornet de glace", "مثلجات في القمع", "a cone held in hand outdoors", "scene-27.jpg"),
    _held("lipstick-display", "Lipstick on display hand", "Rouge sur main déco", "أحمر شفاه على يد عرض", "held by a wooden display hand", "scene-28.jpg"),
    _held("lipstick-hand", "Lipstick in hand", "Rouge en main", "أحمر شفاه في اليد", "a tube held up in one hand in soft light", "scene-29.jpg"),
    _held("unwrapping-gift", "Unwrapping a gift", "Déballage d'un cadeau", "فتح هدية", "a ribboned gift box opened in the hands", "scene-30.jpg"),
    _held("vial-lantern", "Perfume vial", "Fiole de parfum", "قارورة عطر", "a small vial held beside a wooden lantern", "scene-31.jpg"),
    _held("serving-coffee", "Serving coffee", "Service du café", "تقديم القهوة", "poured and served against a green wall", "scene-32.jpg"),
    _held("sunglasses-portrait", "Sunglasses portrait", "Portrait lunettes", "بورتريه نظارة", "worn by a model with a hand touching the frame", "scene-33.jpg"),
    _held("latte-pour", "Latte pour", "Latte versé", "سكب اللاتيه", "milk poured into a dark cup with latte art", "scene-34.jpg"),
    _held("holding-paper", "Holding a booklet", "Livret en main", "إمساك كتيب", "a booklet held in both hands in a bright interior", "scene-35.jpg"),
    _held("oil-in-use", "Olive oil in use", "Huile en usage", "زيت أثناء الاستخدام", "oil poured over a bowl while cooking", "scene-36.jpg"),
    _held("unboxing", "Unboxing", "Déballage", "فتح الصندوق", "a cardboard box opened by the hands", "scene-37.jpg"),
    _held("jewelry-gift", "Jewelry gift", "Bijou cadeau", "هدية مجوهرات", "a jewelry gift box held open in the hands", "scene-38.jpg"),
    _held("watch-handshake", "Watch, handshake", "Montre, poignée de main", "ساعة أثناء المصافحة", "worn on the wrist during a handshake", "scene-39.jpg"),
    _held("rings-nails", "Rings & nails", "Bagues & ongles", "خواتم وأظافر", "worn on a manicured hand over red fur", "scene-40.jpg"),
    _held("dispensing-palm", "Dispensing into palm", "Dosé dans la paume", "توزيع في الكف", "squeezed from a bottle into the palm", "scene-41.jpg"),
    _held("spraying", "Spraying product", "Vaporisation", "رش المنتج", "sprayed from a bottle onto the palm", "scene-42.jpg"),
    _held("pour-glass", "Pouring into a glass", "Versé dans un verre", "سكب في كوب", "poured from a bottle into a glass", "scene-43.jpg"),
    _held("filling-bottle", "Filling a bottle", "Remplissage d'un flacon", "تعبئة زجاجة", "a clear bottle filled by hand", "scene-44.jpg"),
    _held("dessert-hands", "Dessert in hands", "Dessert en mains", "حلوى في اليدين", "a dessert cup held in both hands on a pink backdrop", "scene-45.jpg"),
    _held("pump-overhead", "Pump bottle overhead", "Flacon vue de dessus", "زجاجة من الأعلى", "held in two hands in an overhead flat-lay", "scene-46.jpg"),
]


# ===========================================================================
# CATALOG
# ===========================================================================
# Social-media mockups: fully-composed profile/post templates the user's photo and
# details are dropped into. The mockup is sent to the model as reference #1 and
# reproduced EXACTLY; the scene text (seeded into the editable prompt) tells the model
# to swap in the uploaded photo + the user's name/handle/stats and NOT keep the
# template's original identity. Verified on staging (grok edit reproduces + replaces).
def _social(slug: str, en: str, fr: str, ar: str, scene: str, fname: str, ex: I18n) -> Variant:
    url = f"/mockups/social/{fname}"
    return Variant(slug, i18n(en, fr, ar), scene, url, url, ex)


_REPLACE = ("Replace the avatar with the uploaded photo, and set the name, @handle, "
            "role and stats (posts, followers, following) exactly as described below. "
            "Do not keep the reference's original name, handle or face.")
_QUALITY = "Photorealistic, crisp legible text, high detail."

_SOCIAL_VARIANTS: List[Variant] = [
    _social("neon-profile-held", "Neon profile (in hand)", "Profil neon (en main)", "بروفايل نيون (في اليد)",
            f"Recreate this exact glowing orange neon Instagram profile card held in a hand against a dark bokeh background - same neon outline, glass panel, layout and typography. {_REPLACE} {_QUALITY}",
            "neon-profile-held.jpg",
            i18n("Amine Ouni, @amine.ouni, AI Creator, 128 posts, 42k followers, 12 following",
                 "Amine Ouni, @amine.ouni, Créateur IA, 128 posts, 42k abonnés, 12 abonnements",
                 "أمين، @amine.ouni، صانع محتوى، ١٢٨ منشور، ٤٢ ألف متابع، ١٢ متابَع")),
    _social("neon-desk-sign", "Neon desk sign", "Enseigne neon de bureau", "لوحة نيون على المكتب",
            f"Recreate this exact glowing translucent acrylic profile sign hanging from a desk lamp on a wooden desk beside a laptop, purple-blue ambient light - same neon-edged card, layout and typography. Replace the avatar with the uploaded photo and set the name, @handle, role and message previews exactly as described below. Do not keep the reference's original name or face. {_QUALITY}",
            "neon-desk-sign.jpg",
            i18n("Valeria, @lumina.creates, AI Creator",
                 "Valeria, @lumina.creates, Créatrice IA",
                 "فاليريا، @lumina.creates، صانعة محتوى")),
    _social("glass-profile-card", "Glass profile card", "Carte de profil en verre", "بطاقة بروفايل زجاجية",
            f"Recreate this exact frosted glassmorphism social profile card held between two fingers against a dark background - same translucent glass panel, Follow / Message / Contact buttons, layout and typography. {_REPLACE} {_QUALITY}",
            "glass-profile-card.jpg",
            i18n("Sami Ben Ali, @sami.designs, Blogger - I turn ideas into visuals & websites, 26 posts, 1,565 followers",
                 "Sami Ben Ali, @sami.designs, Blogueur - je transforme les idées en visuels et sites, 26 posts, 1 565 abonnés",
                 "سامي بن علي، @sami.designs، مدوّن - أحوّل الأفكار إلى تصاميم ومواقع، ٢٦ منشور، ١٬٥٦٥ متابع")),
    _social("profile-on-palm", "Floating profile card", "Carte de profil flottante", "بطاقة بروفايل عائمة",
            f"Recreate this exact glossy dark 3D profile card floating above an open palm, warm orange background with a softly blurred person behind - same floating card, layout and typography. {_REPLACE} {_QUALITY}",
            "profile-on-palm.jpg",
            i18n("Dona, @dona.edits, Editor & Graphic Designer, 14 posts, 186 followers, 103 following",
                 "Dona, @dona.edits, Monteuse & Graphiste, 14 posts, 186 abonnés, 103 abonnements",
                 "دُنى، @dona.edits، محرِّرة ومصمّمة جرافيك، ١٤ منشور، ١٨٦ متابع، ١٠٣ متابَع")),
    _social("post-frame-3d", "3D post frame", "Cadre de post 3D", "إطار منشور ثلاثي الأبعاد",
            f"Recreate this exact white 3D social-media post frame floating in a futuristic blue tech environment, with a circular avatar and glossy 3D like / comment / share buttons - same 3D frame, layout and typography. Put the uploaded photo inside the post, set the @handle and comment count exactly as described below, and do not keep the reference's original face. {_QUALITY}",
            "post-frame-3d.jpg",
            i18n("@lihathilitans, 2,470 comments",
                 "@lihathilitans, 2 470 commentaires",
                 "@lihathilitans، ٢٬٤٧٠ تعليق")),
    _social("break-the-screen", "Out of the screen", "Hors de l'ecran", "خارج الشاشة",
            f"Recreate this exact creative 3D social profile where the person bursts out through a torn hole in the profile screen - same profile interface, Follow button, avatar, bio and torn-paper effect. Replace the bursting person and the avatar with the uploaded photo and set the name, bio and stats exactly as described below. Do not keep the reference's original name or face. {_QUALITY}",
            "break-the-screen.jpg",
            i18n("Noor, 231 posts, bio: designer & content creator",
                 "Noor, 231 posts, bio : designer & créatrice de contenu",
                 "نور، ٢٣١ منشور، نبذة: مصمّمة وصانعة محتوى")),
    _social("logo-seat-screen", "On the Instagram logo (feed)", "Sur le logo Instagram (feed)", "على شعار إنستغرام (المنشورات)",
            f"Recreate this exact hyper-realistic 3D scene of a person sitting on a giant Instagram logo in front of their giant profile screen showing their feed grid - same composition, logo and profile layout. Replace the seated person, the avatar and the feed photos with the uploaded photo and set the name, @handle, bio and stats exactly as described below. Do not keep the reference's original name or face. {_QUALITY}",
            "logo-seat-screen.jpg",
            i18n("Gulnaz, @gulnaz.21, 36 posts, 663 followers, 269 following, all I have is a dream",
                 "Gulnaz, @gulnaz.21, 36 posts, 663 abonnés, 269 abonnements, je n'ai qu'un rêve",
                 "غولناز، @gulnaz.21، ٣٦ منشور، ٦٦٣ متابع، ٢٦٩ متابَع، كل ما أملكه حلم")),
    _social("logo-seat-man", "On the Instagram logo", "Sur le logo Instagram", "على شعار إنستغرام",
            f"Recreate this exact hyper-realistic 3D scene of a person sitting on a giant colorful Instagram logo in a clean studio, with a floating profile card beside them - same composition and layout. Replace the seated person and the avatar with the uploaded photo and set the name, @handle, bio and stats exactly as described below. Do not keep the reference's original name or face. {_QUALITY}",
            "logo-seat-man.jpg",
            i18n("Liam Wedding Videos, @liamweddingvids, 15.2k followers, 340 following, Capturing love stories - DM for bookings",
                 "Liam Wedding Videos, @liamweddingvids, 15,2k abonnés, 340 abonnements, Je filme vos histoires d'amour - DM pour réserver",
                 "Liam Wedding Videos، @liamweddingvids، ١٥٫٢ ألف متابع، ٣٤٠ متابَع، نوثّق قصص الحب - راسلنا للحجز")),
    _social("logo-seat-woman", "On the Instagram logo (studio)", "Sur le logo Instagram (studio)", "على شعار إنستغرام (استوديو)",
            f"Recreate this exact hyper-realistic 3D scene of a person sitting on a giant colorful Instagram logo against a soft studio backdrop, with their profile card floating behind - same composition and layout. Replace the seated person and the avatar with the uploaded photo and set the name, @handle, bio and stats exactly as described below. Do not keep the reference's original name or face. {_QUALITY}",
            "logo-seat-woman.jpg",
            i18n("Maria, @mari.creates, 998 posts, 998 followers, Instagram blogger",
                 "Maria, @mari.creates, 998 posts, 998 abonnés, blogueuse Instagram",
                 "ماريا، @mari.creates، ٩٩٨ منشور، ٩٩٨ متابع، مدوّنة إنستغرام")),
    _social("logo-seat-header", "On the Instagram logo (portrait)", "Sur le logo Instagram (portrait)", "على شعار إنستغرام (عمودي)",
            f"Recreate this exact tall hyper-realistic 3D scene of a person sitting on a giant Instagram logo with their profile header shown across the top - same vertical composition and layout. Replace the seated person and the avatar with the uploaded photo and set the name, @handle, bio and stats exactly as described below. Do not keep the reference's original name or face. {_QUALITY}",
            "logo-seat-header.jpg",
            i18n("a_k_gothwal, @a_k_gothwal143, 270 posts, 919 followers, 213 following, welcome to my profile",
                 "a_k_gothwal, @a_k_gothwal143, 270 posts, 919 abonnés, 213 abonnements, bienvenue sur mon profil",
                 "a_k_gothwal، @a_k_gothwal143، ٢٧٠ منشور، ٩١٩ متابع، ٢١٣ متابَع، مرحبًا بك في حسابي")),
    _social("quote-post", "Quote post", "Post citation", "منشور اقتباس",
            f"Recreate this exact frosted-glass Instagram quote post on a soft 3D background - same glass card, 'Quote' badge, big bold quote typography and like / comment / share row. Set the quote text and the author name exactly as described below, and the small profile name and avatar at the top (use the uploaded photo if provided). Keep the elegant layout and make the text crisp and legible. {_QUALITY}",
            "quote-post.jpg",
            i18n("Work hard in silence, let your success make the noise. - Frank Ocean",
                 "Travaille dur en silence, laisse ton succès faire le bruit. - Frank Ocean",
                 "اعمل بصمت، ودع نجاحك يصنع الضجيج. - فرانك أوشن")),
    _social("promo-service-post", "Service promo post", "Post promo service", "منشور ترويجي للخدمة",
            f"Recreate this exact bold purple social-media service / promo post - same energetic layout, headline block, service list with icons, CTA pill and bottom contact bar. Place the uploaded photo as the featured person and set the brand name, headline, services and contact details exactly as described below. Keep it vibrant with crisp legible text. {_QUALITY}",
            "promo-service-post.jpg",
            i18n("iLmixo - Need premium designs? Social media design, branding & identity, creative content. Call 0332-6035819",
                 "iLmixo - Besoin de designs premium ? Design réseaux sociaux, branding & identité, contenu créatif. Appelez le 0332-6035819",
                 "iLmixo - تحتاج تصاميم احترافية؟ تصميم سوشيال ميديا، هوية وبراندينغ، محتوى إبداعي. اتصل: 0332-6035819")),
    _social("phone-collage", "Phone collage", "Collage de telephones", "كولاج الهواتف",
            f"Recreate this exact creative flat-lay of several phones on a clean white surface, each screen showing a different close-up section (hair, eye, nose, lips) of one face so together they form a single fragmented portrait. Use the uploaded photo as the face. Keep the clean minimal composition. {_QUALITY}",
            "phone-collage.jpg",
            i18n("my portrait split across the phone screens, warm natural tones",
                 "mon portrait réparti sur les écrans des téléphones, tons chauds et naturels",
                 "صورتي موزّعة على شاشات الهواتف، بألوان دافئة وطبيعية")),
]


# ===========================================================================
# Quote-card mockups: fully-composed "hand holding a card" scenes the user's own
# quote is dropped into. Like Social, the mockup is sent as reference #1 and
# reproduced EXACTLY; the scene text tells the model to swap ONLY the quote text
# (no face/identity to replace) and keep the card, frame, glow and typography.
def _quote(slug: str, en: str, fr: str, ar: str, scene: str, fname: str, ex: I18n) -> Variant:
    url = f"/mockups/quote/{fname}"
    return Variant(slug, i18n(en, fr, ar), scene, url, url, ex)


_QREPLACE = ("Replace ONLY the quote text with the user's words below; keep the exact "
             "same scene, hand, card, frame, colors, glow and typographic style. "
             "Do not keep the reference's original words.")
_QQUALITY = "Photorealistic, crisp legible text (supports Arabic), high detail."

_QUOTE_VARIANTS: List[Variant] = [
    _quote("ember-glass-portrait", "Ember glass card", "Carte de verre incandescente", "بطاقة زجاج متوهّجة",
           f"Recreate this exact cinematic scene of a woman's face beside a glowing ember-lit glass card with molten fiery edges, dark background with drifting sparks and smoke - same face, glass card, fire glow and elegant serif layout. {_QREPLACE} {_QQUALITY}",
           "ember-glass-portrait.jpg",
           i18n("I am the storm that is approaching",
                "Je suis la tempête qui approche",
                "أنا العاصفة القادمة")),
    _quote("fire-card", "Card on fire", "Carte en feu", "بطاقة مشتعلة",
           f"Recreate this exact transparent card held in a hand, engulfed in real flames with the words themselves made of fire, dark smoky background with glowing embers - same burning card, fiery letterforms, hand and embers. Replace ONLY the words with the user's short quote below, keeping the flaming fire-text style, glow and composition. Do not keep the reference's original words. {_QQUALITY}",
           "fire-card.jpg",
           i18n("Rise from the ashes",
                "Renais de tes cendres",
                "انهض من الرماد")),
    _quote("neon-card", "Neon glass card", "Carte néon", "بطاقة نيون",
           f"Recreate this exact frosted translucent card held in a hand with a glowing cyan-and-pink neon border, dark background with a soft light beam - same neon-edged glass card, hand and glow. {_QREPLACE} Keep the neon typographic style (bright uppercase sans + pink script). {_QQUALITY}",
           "neon-card.jpg",
           i18n("Shine brighter than your doubts",
                "Brille plus fort que tes doutes",
                "تألّق أكثر من شكوكك")),
    _quote("neon-card-tall", "Neon card (portrait)", "Carte néon (vertical)", "بطاقة نيون (عمودية)",
           f"Recreate this exact tall frosted glass card held in a hand with a glowing cyan-and-pink neon border, dark cinematic background with bokeh - same vertical neon glass card, hand and glow. {_QREPLACE} Keep the soft neon glow and centered layout. {_QQUALITY}",
           "neon-card-tall.jpg",
           i18n("And with hardship comes ease",
                "À côté de la difficulté est une facilité",
                "إنَّ مع العُسر يُسرًا")),
    _quote("gold-luxury-card", "Gold luxury card", "Carte dorée de luxe", "بطاقة ذهبية فاخرة",
           f"Recreate this exact premium matte navy-black card held in a hand with a thin gold Art-Deco border, a warm spotlight from above on a dark background - same luxury card, gold-foil border, hand and lighting. {_QREPLACE} Keep the elegant centered gold-foil typography and premium mood. {_QQUALITY}",
           "gold-luxury-card.jpg",
           i18n("Luxury lives in simplicity",
                "Le luxe est dans la simplicité",
                "الفخامة في البساطة")),
    _quote("gold-script-card", "Gold script card", "Carte script doré", "بطاقة بخط ذهبي",
           f"Recreate this exact black card held in a hand with a thin ornate gold frame, dark smoky background with a warm glow - same card, gold border, hand and lighting. Replace ONLY the centered gold script quote with the user's words below, keeping the elegant gold-foil calligraphic script, centered layout and refined mood. Do not keep the reference's original words. {_QQUALITY}",
           "gold-script-card.jpg",
           i18n("Simplicity is the ultimate sophistication",
                "La simplicité est la sophistication suprême",
                "البساطة قمّة الرُّقيّ")),
    _quote("ornate-gold-frame", "Ornate gold frame", "Cadre doré ornemental", "إطار ذهبي مزخرف",
           f"Recreate this exact black card held in a hand with a richly ornate vintage gold-foil frame, a warm lamp and marble softly blurred in the background - same card, ornamental gold border, hand and cozy lighting. Replace ONLY the gold quote near the bottom with the user's words below, keeping the classic gold-foil serif typography and luxurious mood. Do not keep the reference's original words. {_QQUALITY}",
           "ornate-gold-frame.jpg",
           i18n("Luxury is in each detail",
                "Le luxe est dans chaque détail",
                "الفخامة في كل تفصيل")),
    _quote("gold-corner-card", "Gold-corner card", "Carte à coins dorés", "بطاقة بزوايا ذهبية",
           f"Recreate this exact black card held in a hand with ornate gold-foil corner flourishes and a thin gold frame, moody dark background with a warm glow - same card, gold cornerwork, hand and lighting. Replace ONLY the small gold caption near the bottom with the user's words below, keeping the delicate gold-foil typography and premium mood. Do not keep the reference's original words. {_QQUALITY}",
           "gold-corner-card.jpg",
           i18n("Beauty is in the details",
                "La beauté est dans les détails",
                "الجمال في التفاصيل")),
]


# ===========================================================================
# Digital-product promo posters: ready-made marketing posters for reselling
# subscriptions, streaming accounts, game top-ups and gift cards. Like Social/
# Quote, the poster is sent as reference #1 and reproduced EXACTLY; the scene text
# tells the model to swap ONLY the product name, prices, features and contact for
# the user's, keeping the layout, logos and style. (Verified: grok holds a dense
# Arabic/French promo and rewrites the offer legibly.)
def _digital(slug: str, en: str, fr: str, ar: str, subject: str, fname: str, ex: I18n) -> Variant:
    url = f"/mockups/digital/{fname}"
    scene = (
        f"Recreate this exact promotional poster for {subject} - same layout, background, "
        f"colours, icons and brand logos, badges and typography. Replace the product name, "
        f"prices, feature lines and contact details with the user's details below; keep every "
        f"graphic element and the layout identical, vibrant with crisp legible text (Arabic and "
        f"Latin). Do not keep the reference's original brand names or prices. Photorealistic, high detail."
    )
    return Variant(slug, i18n(en, fr, ar), scene, url, url, ex)


_DIGITAL_VARIANTS: List[Variant] = [
    _digital("summer-ai-promo", "Summer AI promo", "Promo IA été", "عرض صيفي للذكاء", "a summer sale of AI & software subscriptions", "dp-01.jpg",
             i18n("Summer Sale — Gemini Pro 40DT, ChatGPT 60DT, Canva Pro 15DT · DM to order", "Soldes d'été — Gemini Pro 40DT, ChatGPT 60DT, Canva Pro 15DT · MP pour commander", "تخفيضات الصيف — Gemini Pro 40 دت، ChatGPT 60 دت، Canva Pro 15 دت · راسلنا للطلب")),
    _digital("ramadan-netflix", "Ramadan streaming", "Streaming Ramadan", "بث رمضان", "a Ramadan streaming-account promo (Netflix style)", "dp-02.jpg",
             i18n("Ramadan Offer — Netflix 1 month, full account, only 10DT", "Offre Ramadan — Netflix 1 mois, compte complet, 10DT", "عرض رمضان — نتفليكس شهر كامل بحساب شخصي بـ10 دت")),
    _digital("steam-game-account", "Game account promo", "Promo compte jeu", "عرض حساب لعبة", "a Steam / game account promo (football game)", "dp-03.jpg",
             i18n("FC26 Steam account — full access, fresh 0 hour, 35DT", "Compte Steam FC26 — accès complet, 0 heure, 35DT", "حساب ستيم FC26 — وصول كامل، جديد، 35 دت")),
    _digital("worldcup-promo", "World-Cup promo", "Promo Coupe du Monde", "عرض كأس العالم", "a football World-Cup themed subscription promo with three activation codes", "dp-04.jpg",
             i18n("ChatGPT Plus — 12 months 40DT · 6 months 25DT · free Notion Pro", "ChatGPT Plus — 12 mois 40DT · 6 mois 25DT · Notion Pro offert", "ChatGPT Plus — 12 شهر 40 دت · 6 أشهر 25 دت · Notion Pro مجانًا")),
    _digital("chatgpt-assistant-pink", "ChatGPT assistant", "Assistant ChatGPT", "مساعد ChatGPT", "a pink ChatGPT AI-assistant subscription promo with a robot mascot", "dp-05.jpg",
             i18n("ChatGPT — smart answers in seconds, 1 month 20DT", "ChatGPT — réponses intelligentes, 1 mois 20DT", "ChatGPT — إجابات ذكية سريعة، شهر بـ20 دت")),
    _digital("google-ai-pro-devices", "Google AI Pro", "Google AI Pro", "Google AI Pro", "a Google AI Pro / Gemini subscription promo with a laptop and phone", "dp-06.jpg",
             i18n("Google AI Pro — all AI tools in one, 45DT/year", "Google AI Pro — tous les outils IA, 45DT/an", "Google AI Pro — كل أدوات الذكاء بـ45 دت/سنة")),
    _digital("claude-agents-course", "AI agents course", "Formation agents IA", "دورة وكلاء الذكاء", "an AI-agents training course promo (Claude + AI agents)", "dp-07.jpg",
             i18n("Claude + AI Agents training — 600DT (was 850DT)", "Formation Claude + Agents IA — 600DT (au lieu de 850DT)", "دورة Claude ووكلاء الذكاء — 600 دت بدل 850")),
    _digital("ai-bundle-light", "AI bundle", "Pack IA", "باقة الذكاء", "a premium AI-subscriptions bundle with many tool logos", "dp-08.jpg",
             i18n("Premium AI bundle — ChatGPT, Gemini, Canva, CapCut · verified accounts", "Pack IA premium — ChatGPT, Gemini, Canva, CapCut · comptes vérifiés", "باقة الذكاء المميزة — ChatGPT وGemini وCanva وCapCut · حسابات موثوقة")),
    _digital("ai-digital-premium", "AI & digital premium", "IA & digital premium", "اشتراكات مميزة", "a premium AI & digital subscriptions catalogue with tool logos", "dp-09.jpg",
             i18n("AI & digital subscriptions — CapCut Pro, Google AI, SuperGrok", "Abonnements IA & digitaux — CapCut Pro, Google AI, SuperGrok", "اشتراكات الذكاء والرقمية — CapCut Pro وGoogle AI وSuperGrok")),
    _digital("google-ai-ultra", "Google AI Ultra", "Google AI Ultra", "Google AI Ultra", "a Google AI Ultra credits promo on a tech circuit background", "dp-10.jpg",
             i18n("Google AI Ultra — 45,000 credits, Veo 3.1, 2TB storage", "Google AI Ultra — 45 000 crédits, Veo 3.1, 2To", "Google AI Ultra — 45,000 رصيد، Veo 3.1، 2TB")),
    _digital("coc-topup", "Clash of Clans top-up", "Recharge Clash of Clans", "شحن كلاش أوف كلانس", "a Clash of Clans gems top-up price list", "dp-11.jpg",
             i18n("Clash of Clans top-up — fast & safe, no ban risk", "Recharge Clash of Clans — rapide & sûr, sans risque de ban", "شحن كلاش أوف كلانس — سريع وآمن بدون خطر حظر")),
    _digital("supergrok-pro", "SuperGrok Pro", "SuperGrok Pro", "SuperGrok Pro", "a SuperGrok Pro AI subscription promo, gold on black", "dp-12.jpg",
             i18n("SuperGrok Pro — smart, fast, powerful · from 35DT/month", "SuperGrok Pro — intelligent, rapide · à partir de 35DT/mois", "SuperGrok Pro — ذكي وسريع · من 35 دت/شهر")),
    _digital("capcut-pro-purple", "CapCut Pro", "CapCut Pro", "CapCut Pro", "a CapCut Pro video-editing subscription promo, neon purple", "dp-13.jpg",
             i18n("CapCut Pro — pro video editing, from 20DT/month", "CapCut Pro — montage pro, à partir de 20DT/mois", "CapCut Pro — مونتاج احترافي، من 20 دت/شهر")),
    _digital("digital-services-grid", "Digital services", "Services digitaux", "خدمات رقمية", "an all-in-one digital-services promo with many app logos", "dp-14.jpg",
             i18n("All digital services in one place — accounts, top-ups, subs", "Tous vos services digitaux — comptes, recharges, abonnements", "كل الخدمات الرقمية في مكان واحد — حسابات وشحن واشتراكات")),
    _digital("gemini-pro-box", "Gemini Pro (boxed)", "Gemini Pro (coffret)", "Gemini Pro (علبة)", "a boxed Gemini Pro 18-month subscription product shot", "dp-15.jpg",
             i18n("Gemini Pro — 18-month subscription, personal account, 45DT", "Gemini Pro — abonnement 18 mois, compte perso, 45DT", "Gemini Pro — اشتراك 18 شهر بحساب شخصي، 45 دت")),
    _digital("clash-royale-topup", "Clash Royale top-up", "Recharge Clash Royale", "شحن كلاش رويال", "a Clash Royale gems top-up price list", "dp-16.jpg",
             i18n("Clash Royale top-up — fast, 100% safe, no ban", "Recharge Clash Royale — rapide, 100% sûr", "شحن كلاش رويال — سريع وآمن 100%")),
    _digital("streaming-price-list", "Streaming price list", "Tarifs streaming", "أسعار البث", "a streaming-subscriptions gift-card price list (Netflix, Spotify, Disney+)", "dp-17.jpg",
             i18n("Streaming price list — Netflix, Spotify, Disney+, YouTube Premium", "Tarifs streaming — Netflix, Spotify, Disney+, YouTube", "أسعار البث — Netflix وSpotify وDisney+ وYouTube")),
    _digital("gemini-advanced-offer", "Gemini Advanced", "Gemini Advanced", "Gemini Advanced", "a Gemini Advanced 18-month subscription promo with a happy couple", "dp-18.jpg",
             i18n("Gemini Advanced — 18 months, activate before paying, 20DT", "Gemini Advanced — 18 mois, activation avant paiement, 20DT", "Gemini Advanced — 18 شهر، تفعيل قبل الدفع، 20 دت")),
    _digital("coursera-plus", "Coursera Plus", "Coursera Plus", "Coursera Plus", "a Coursera Plus annual learning-subscription promo", "dp-19.jpg",
             i18n("Coursera Plus — 7,000+ courses, 1 full year, 55DT", "Coursera Plus — 7 000+ cours, 1 an, 55DT", "Coursera Plus — أكثر من 7000 دورة، سنة كاملة، 55 دت")),
    _digital("pc-games-bundle", "PC games bundle", "Pack jeux PC", "باقة ألعاب PC", "a PC games bundle promo (FC26, GTA 5, ARC Raiders)", "dp-20.jpg",
             i18n("Top PC games — FC26 65DT, ARC Raiders 105DT, GTA 5 45DT", "Top jeux PC — FC26 65DT, ARC Raiders 105DT, GTA 5 45DT", "أفضل ألعاب PC — FC26 65 دت، ARC 105 دت، GTA 5 45 دت")),
    _digital("claude-ai-pro", "Claude AI Pro", "Claude AI Pro", "Claude AI Pro", "a Claude AI Pro subscription promo, orange on black", "dp-21.jpg",
             i18n("Claude AI Pro — smart, creative, 49DT/month", "Claude AI Pro — intelligent, créatif, 49DT/mois", "Claude AI Pro — ذكي ومبدع، 49 دت/شهر")),
    _digital("google-ai-pro-year", "Google AI Pro (yearly)", "Google AI Pro (annuel)", "Google AI Pro (سنوي)", "a Google AI Pro yearly subscription promo with Nano Banana", "dp-22.jpg",
             i18n("Google AI Pro — 1 dinar/year offer, Nano Banana, Veo 3.1", "Google AI Pro — offre 1 dinar/an, Nano Banana, Veo 3.1", "Google AI Pro — عرض دينار/السنة، Nano Banana، Veo 3.1")),
    _digital("mobile-legends-pricelist", "Mobile Legends prices", "Tarifs Mobile Legends", "أسعار موبايل ليجندز", "a Mobile Legends diamonds price list", "dp-23.jpg",
             i18n("Mobile Legends — diamonds price list, best prices", "Mobile Legends — tarifs diamants, meilleurs prix", "موبايل ليجندز — قائمة أسعار الجواهر بأفضل سعر")),
    _digital("nexar-ai-universe", "Nexar AI Universe", "Nexar AI Universe", "Nexar AI Universe", "a Nexar AI Universe creative-AI workspace subscription promo", "dp-24.jpg",
             i18n("Nexar AI Universe — creative AI workspace, from 25DT", "Nexar AI Universe — espace créatif IA, dès 25DT", "Nexar AI Universe — مساحة إبداعية، من 25 دت")),
    _digital("canva-pro-tiers", "Canva Pro tiers", "Canva Pro paliers", "Canva Pro باقات", "a Canva Pro subscription promo with three price tiers", "dp-25.jpg",
             i18n("Canva Pro — 12 months 12DT · 24 months 20DT · 36 months 28DT", "Canva Pro — 12 mois 12DT · 24 mois 20DT · 36 mois 28DT", "Canva Pro — 12 شهر 12 دت · 24 شهر 20 دت · 36 شهر 28 دت")),
    _digital("chatgpt-plus-gold", "ChatGPT Plus (gold)", "ChatGPT Plus (or)", "ChatGPT Plus (ذهبي)", "a ChatGPT Plus subscription promo, gold on black", "dp-26.jpg",
             i18n("ChatGPT Plus — the world's #1 AI, from 26DT/month", "ChatGPT Plus — l'IA n°1, à partir de 26DT/mois", "ChatGPT Plus — الأشهر عالميًا، من 26 دت/شهر")),
    _digital("claude-pro-box", "Claude Pro (boxed)", "Claude Pro (coffret)", "Claude Pro (علبة)", "a boxed Claude Pro by Anthropic product shot", "dp-27.jpg",
             i18n("Claude Pro by Anthropic — official account, Claude Code included", "Claude Pro by Anthropic — compte officiel, Claude Code inclus", "Claude Pro من Anthropic — حساب رسمي مع Claude Code")),
    _digital("ai-tools-basket", "AI tools basket", "Panier d'outils IA", "سلة أدوات الذكاء", "a best-AI-tools promo with subscription cards in a basket", "dp-28.jpg",
             i18n("Best AI tools — ChatGPT Plus + Claude AI Pro, study & work", "Meilleurs outils IA — ChatGPT Plus + Claude AI Pro", "أفضل أدوات الذكاء — ChatGPT Plus وClaude AI Pro")),
    _digital("claude-official-sub", "Claude official", "Claude officiel", "Claude الرسمي", "an official Claude subscription promo with a laptop", "dp-29.jpg",
             i18n("Official Claude subscription — premium account, 85DT", "Abonnement Claude officiel — compte premium, 85DT", "اشتراك Claude رسمي — حساب مميز، 85 دت")),
    _digital("gemini-pro-banner", "Gemini Pro banner", "Bannière Gemini Pro", "بانر Gemini Pro", "a horizontal Google Gemini Pro subscription banner", "dp-30.jpg",
             i18n("Gemini Pro — 18-month premium access, 5TB, only 45 dinars", "Gemini Pro — accès 18 mois, 5To, 45 dinars", "Gemini Pro — وصول 18 شهر، 5TB، 45 دينار فقط")),
    _digital("mobile-legends-topup", "Mobile Legends top-up", "Recharge Mobile Legends", "شحن موبايل ليجندز", "a Mobile Legends diamonds top-up price list", "dp-31.jpg",
             i18n("Mobile Legends top-up — diamonds, fast & 100% safe", "Recharge Mobile Legends — diamants, rapide & sûr", "شحن موبايل ليجندز — جواهر، سريع وآمن 100%")),
    _digital("ps5-gta-accounts", "PS5 game accounts", "Comptes jeux PS5", "حسابات ألعاب PS5", "a PS5 / GTA V game-account promo", "dp-32.jpg",
             i18n("GTA V PS5 — full account 290DT, shared 190DT", "GTA V PS5 — compte complet 290DT, partagé 190DT", "GTA V PS5 — حساب كامل 290 دت، مشترك 190 دت")),
    _digital("streaming-anything-disney", "Streaming offer", "Offre streaming", "عرض البث", "a streaming-subscriptions promo (Disney+ and more), gold on black", "dp-33.jpg",
             i18n("Anything you want online — Disney+ and more, we deliver", "Tout ce que vous voulez en ligne — Disney+ et plus", "أي حاجة تحب تاخوها من الإنترنت — Disney+ وأكثر")),
    _digital("gift-card-pricelist", "Gift-card prices", "Tarifs cartes cadeaux", "أسعار البطاقات", "a streaming gift-card price list", "dp-34.jpg",
             i18n("Gift-card prices — Netflix, Spotify, Disney+, Claude Pro", "Tarifs cartes cadeaux — Netflix, Spotify, Disney+, Claude", "أسعار البطاقات — Netflix وSpotify وDisney+ وClaude")),
    _digital("mobile-legends-gold", "Mobile Legends diamonds", "Diamants Mobile Legends", "جواهر موبايل ليجندز", "a Mobile Legends diamonds promo with gold warrior art", "dp-35.jpg",
             i18n("Mobile Legends — 5000 diamonds, instant top-up", "Mobile Legends — 5000 diamants, recharge instantanée", "موبايل ليجندز — 5000 جوهرة، شحن فوري")),
    _digital("n8n-agents-course", "n8n & AI agents course", "Formation n8n & IA", "دورة n8n والوكلاء", "an n8n & AI-agents mastery course promo (NVIDIA-certified)", "dp-36.jpg",
             i18n("Master n8n & AI Agents — 60h course, 600DT, NVIDIA certified", "Maîtrisez n8n & Agents IA — 60h, 600DT", "احترف n8n ووكلاء الذكاء — 60 ساعة، 600 دت")),
    _digital("gift-cards-grid", "Gift cards", "Cartes cadeaux", "بطاقات هدايا", "a gaming gift-cards promo (PlayStation, Steam, Xbox, Roblox, Apple)", "dp-37.jpg",
             i18n("Gaming gift cards — PlayStation, Steam, Xbox, Roblox, Apple", "Cartes cadeaux gaming — PlayStation, Steam, Xbox, Roblox", "بطاقات هدايا — PlayStation وSteam وXbox وRoblox")),
    _digital("manus-ai-pro", "Manus AI Pro", "Manus AI Pro", "Manus AI Pro", "a Manus AI Pro subscription promo with monthly tokens", "dp-38.jpg",
             i18n("Manus AI Pro — 2,500 tokens/month, from 50DT/month", "Manus AI Pro — 2 500 tokens/mois, dès 50DT/mois", "Manus AI Pro — 2500 توكن شهريًا، من 50 دت/شهر")),
    _digital("ai-video-ultra", "AI video (Ultra)", "Vidéo IA (Ultra)", "فيديو الذكاء", "an AI-video generation promo (Google AI Ultra, Veo, Flow)", "dp-39.jpg",
             i18n("Create pro AI videos in seconds — Google AI Ultra, 50DT/month", "Vidéos IA pro en secondes — Google AI Ultra, 50DT/mois", "فيديوهات ذكاء احترافية — Google AI Ultra، 50 دت/شهر")),
    _digital("canva-pro-year", "Canva Pro (1 year)", "Canva Pro (1 an)", "Canva Pro (سنة)", "a Canva Pro one-year subscription promo, yellow on black", "dp-40.jpg",
             i18n("Canva Pro — full access, 1 year for 15DT", "Canva Pro — accès complet, 1 an pour 15DT", "Canva Pro — وصول كامل، سنة بـ15 دت")),
    _digital("ai-llm-course", "AI & LLM course", "Formation IA & LLM", "دورة الذكاء وLLM", "an AI agents & LLM training course promo (NVIDIA-certified)", "dp-41.jpg",
             i18n("AI Agents & LLM training — 60h, NVIDIA certified, 600DT", "Formation Agents IA & LLM — 60h, certifié NVIDIA, 600DT", "دورة وكلاء الذكاء وLLM — 60 ساعة، 600 دت")),
    _digital("ramadan-gemini", "Ramadan Gemini", "Gemini Ramadan", "جيميني رمضان", "a Ramadan-themed Gemini Pro subscription promo", "dp-42.jpg",
             i18n("Ramadan Kareem — Gemini Pro 12 months, 40 TND", "Ramadan Kareem — Gemini Pro 12 mois, 40 TND", "رمضان كريم — Gemini Pro 12 شهر، 40 دينار")),
    _digital("premium-digital-hub", "Premium digital hub", "Hub digital premium", "منصة رقمية مميزة", "an all-in-one premium digital-tools hub promo with many logos", "dp-43.jpg",
             i18n("Your premium digital hub — best tools, one price", "Votre hub digital premium — les meilleurs outils, un prix", "منصتك الرقمية المميزة — أفضل الأدوات بسعر واحد")),
    _digital("gemini-pro-box-year", "Gemini Pro (1-year box)", "Gemini Pro (coffret 1 an)", "Gemini Pro (علبة سنة)", "a boxed Gemini Pro one-year product shot", "dp-44.jpg",
             i18n("Gemini Pro — Google's most advanced AI, 1 year 25DT", "Gemini Pro — l'IA la plus avancée, 1 an 25DT", "Gemini Pro — أقوى ذكاء من جوجل، سنة 25 دت")),
    _digital("ramadan-mega-sale", "Ramadan mega sale", "Méga soldes Ramadan", "تخفيضات رمضان", "a Ramadan mega-sale game top-up price list", "dp-45.jpg",
             i18n("Ramadan Mega Sale — top-ups from 20 TND, limited time", "Méga soldes Ramadan — recharges dès 20 TND", "تخفيضات رمضان الكبرى — شحن من 20 دينار")),
    _digital("chatgpt-student", "ChatGPT student offer", "Offre étudiant ChatGPT", "عرض الطلبة ChatGPT", "a ChatGPT Plus student-exam promo with students studying", "dp-46.jpg",
             i18n("ChatGPT Plus — student offer for exams, 18DT/month", "ChatGPT Plus — offre étudiant examens, 18DT/mois", "ChatGPT Plus — عرض الطلبة للامتحانات، 18 دت/شهر")),
    _digital("gemini-2tb", "Gemini + 2TB Drive", "Gemini + 2To Drive", "Gemini + 2TB", "a Gemini AI Pro + 2TB Google Drive subscription promo", "dp-47.jpg",
             i18n("Gemini AI Pro + 2TB Google Drive — 40 TND", "Gemini AI Pro + 2To Google Drive — 40 TND", "Gemini AI Pro + 2TB درايف — 40 دينار")),
    _digital("gemini-mascot", "Gemini (mascot)", "Gemini (mascotte)", "Gemini (روبوت)", "a Gemini AI-assistant subscription promo with a robot mascot", "dp-48.jpg",
             i18n("Gemini — Google's smart assistant, 3 months from 59DT", "Gemini — l'assistant de Google, 3 mois dès 59DT", "Gemini — مساعد جوجل الذكي، 3 أشهر من 59 دت")),
    _digital("google-ai-pro-phone", "Google AI Pro (phone)", "Google AI Pro (mobile)", "Google AI Pro (هاتف)", "a Google AI Pro subscription promo with a smartphone", "dp-49.jpg",
             i18n("Google AI Pro — monthly or yearly, activate on your account", "Google AI Pro — mensuel ou annuel, sur votre compte", "Google AI Pro — شهري أو سنوي، على حسابك الشخصي")),
    _digital("virtual-visa-card", "Virtual Visa card", "Carte Visa virtuelle", "بطاقة فيزا افتراضية", "a virtual Visa prepaid card promo (dollars / euro)", "dp-50.jpg",
             i18n("Virtual Visa card — pay in dollars/euro, lowest price in Tunisia", "Carte Visa virtuelle — payez en dollars/euro", "بطاقة فيزا افتراضية — ادفع بالدولار/اليورو، أرخص سعر")),
    _digital("ai-catalogue-light", "AI subscriptions", "Abonnements IA", "اشتراكات الذكاء", "a premium AI & software subscriptions catalogue (light theme)", "dp-51.jpg",
             i18n("Premium AI & software subscriptions — verified, fast activation", "Abonnements IA & logiciels premium — vérifiés, activation rapide", "اشتراكات الذكاء والبرامج المميزة — موثوقة وتفعيل سريع")),
]


PACKS: List[Pack] = [
    # ----------------------- 1.1  E-commerce -----------------------
    # Every e-commerce category is its own freeform "studio" (mirrors tshirt-studio):
    # the card opens that category's mockup-scene picker, then the agent studio where
    # the user describes/uploads their product. Scenes derive from each category's
    # natural options; images live under /mockups/ecommerce/<category>/<scene>.png.
    Pack(
        id="product-on-white",
        sector="ecommerce",
        order=1,
        capability="edit-from-reference",
        kind="freeform",
        requires_image_input=True,
        prompt_template="{{prompt}}",
        default_prompt="remove the existing background of the uploaded product and place it on a clean seamless studio background, keep the product unchanged, soft reflection beneath, even lighting, high detail",
        example_i18n=i18n("a brown leather wallet", "un portefeuille en cuir marron", "محفظة جلد بني"),
        title_i18n=i18n("Product on solid color", "Produit sur fond uni", "المنتج على خلفية لون موحّد"),
        description_i18n=i18n(
            "Upload a product and swap its background to a clean color.",
            "Importez un produit et changez son fond pour une couleur nette.",
            "ارفع منتجًا وغيّر خلفيته إلى لون نظيف.",
        ),
        slots=[
            prompt_slot(
                i18n("Describe your product", "Décrivez votre produit", "صِف منتجك"),
                placeholder=i18n("e.g. a brown leather wallet", "ex. un portefeuille en cuir marron", "مثال: محفظة جلد بني"),
                required=False,
            ),
        ],
        variants=[
            Variant("white", i18n("White", "Blanc", "أبيض"),
                    "remove the existing background of the uploaded product and replace it with a seamless pure white studio background, keep the product itself unchanged, soft reflection beneath, even lighting, sharp focus, high detail",
                    "/mockups/ecommerce/product-on-white/white.png", "/mockups/ecommerce/product-on-white/white.png"),
            Variant("black", i18n("Black", "Noir", "أسود"),
                    "remove the existing background of the uploaded product and replace it with a seamless deep black studio background, keep the product itself unchanged, soft reflection beneath, dramatic even lighting, high detail",
                    "/mockups/ecommerce/product-on-white/black.png", "/mockups/ecommerce/product-on-white/black.png"),
            Variant("light-grey", i18n("Light grey", "Gris clair", "رمادي فاتح"),
                    "remove the existing background of the uploaded product and replace it with a seamless light grey studio background, keep the product itself unchanged, soft shadow beneath, even lighting, high detail",
                    "/mockups/ecommerce/product-on-white/light-grey.png", "/mockups/ecommerce/product-on-white/light-grey.png"),
            Variant("beige", i18n("Beige", "Beige", "بيج"),
                    "remove the existing background of the uploaded product and replace it with a seamless warm beige studio background, keep the product itself unchanged, soft shadow beneath, even lighting, high detail",
                    "/mockups/ecommerce/product-on-white/beige.png", "/mockups/ecommerce/product-on-white/beige.png"),
            Variant("soft-blue", i18n("Soft blue", "Bleu doux", "أزرق فاتح"),
                    "remove the existing background of the uploaded product and replace it with a seamless soft pastel blue studio background, keep the product itself unchanged, soft shadow beneath, even lighting, high detail",
                    "/mockups/ecommerce/product-on-white/soft-blue.png", "/mockups/ecommerce/product-on-white/soft-blue.png"),
            Variant("blush-pink", i18n("Blush pink", "Rose poudré", "وردي فاتح"),
                    "remove the existing background of the uploaded product and replace it with a seamless soft blush pink studio background, keep the product itself unchanged, soft shadow beneath, even lighting, high detail",
                    "/mockups/ecommerce/product-on-white/blush-pink.png", "/mockups/ecommerce/product-on-white/blush-pink.png"),
        ],
        aspect_ratios=["1:1", "4:5"],
        default_n=2,
        tags=["ecommerce", "product", "studio", "background", "color", "freeform"],
    ),
    Pack(
        id="lifestyle-in-use",
        sector="ecommerce",
        order=2,
        capability="photoreal",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="a lifestyle photo of the uploaded product in use, natural light, candid, aspirational",
        example_i18n=i18n("a ceramic coffee mug", "un mug en céramique", "كوب قهوة خزفي"),
        title_i18n=i18n("Product in scene / lifestyle", "Produit en situation / lifestyle", "المنتج في مشهد / لايف ستايل"),
        description_i18n=i18n(
            "Drop your product into a real contextual background scene.",
            "Placez votre produit dans un décor réel et contextuel.",
            "ضَع منتجك داخل مشهد خلفية واقعي ومناسب.",
        ),
        slots=[
            prompt_slot(
                i18n("Describe your product", "Décrivez votre produit", "صِف منتجك"),
                placeholder=i18n("e.g. a ceramic coffee mug", "ex. un mug en céramique", "مثال: كوب قهوة خزفي"),
                required=False,
            ),
        ],
        variants=_LIFESTYLE_VARIANTS,
        aspect_ratios=["4:5", "1:1"],
        default_n=2,
        tags=["ecommerce", "lifestyle", "product", "studio", "freeform"],
    ),
    Pack(
        id="packaging-label",
        sector="ecommerce",
        order=5,
        capability="edit-from-reference",
        kind="freeform",
        requires_image_input=True,
        prompt_template="{{prompt}}",
        default_prompt="the uploaded label or design applied to a realistic product package, accurate perspective and lighting, high detail",
        example_i18n=i18n("a skincare serum bottle", "un flacon de sérum pour la peau", "زجاجة سيروم للعناية بالبشرة"),
        title_i18n=i18n("Packaging / label", "Emballage / étiquette", "التغليف / الملصق"),
        description_i18n=i18n(
            "Render your label or box design on realistic packaging.",
            "Affichez votre étiquette ou design sur un emballage réaliste.",
            "اعرض ملصقك أو تصميمك على عبوة واقعية.",
        ),
        slots=[
            prompt_slot(
                i18n("Describe the product (upload your label)", "Décrivez le produit (importez l'étiquette)", "صِف المنتج (ارفع الملصق)"),
                placeholder=i18n("e.g. a skincare serum bottle", "ex. un flacon de sérum", "مثال: زجاجة سيروم للعناية"),
                required=False,
            ),
        ],
        variants=_PACKAGING_VARIANTS,
        aspect_ratios=["1:1", "4:5"],
        default_n=2,
        tags=["ecommerce", "packaging", "label", "mockup", "studio", "freeform"],
    ),
    Pack(
        id="sale-promo-badge",
        sector="ecommerce",
        order=3,
        capability="text-in-image",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="an eye-catching sale graphic of the uploaded product with a bold headline and discount badge",
        example_i18n=i18n("wireless earbuds, Mega Sale, -30%", "écouteurs sans fil, Méga Soldes, -30%", "سماعات لاسلكية، تخفيضات كبرى، -٣٠٪"),
        title_i18n=i18n("Sale / promo badge", "Visuel promo", "إعلان تخفيضات"),
        description_i18n=i18n(
            "Pick a badge style, then describe your product and offer.",
            "Choisissez un style de badge, puis décrivez votre produit et l'offre.",
            "اختر نمط الشارة، ثم صف منتجك وعرضك.",
        ),
        slots=[
            prompt_slot(
                i18n("Product, headline & discount", "Produit, accroche & remise", "المنتج والعنوان والخصم"),
                placeholder=i18n("e.g. wireless earbuds, Mega Sale, -30%", "ex. écouteurs sans fil, Méga Soldes, -30%", "مثال: سماعات لاسلكية، تخفيضات كبرى، -٣٠٪"),
                required=False,
            ),
        ],
        variants=_BADGE_VARIANTS,
        aspect_ratios=["1:1", "9:16"],
        default_n=2,
        tags=["ecommerce", "promo", "sale", "text", "studio", "freeform"],
    ),
    Pack(
        id="seasonal-campaign",
        sector="ecommerce",
        order=4,
        capability="photoreal",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="a festive seasonal-themed product photo of the uploaded product, decorative props, warm lighting",
        example_i18n=i18n("a box of dates", "une boîte de dattes", "علبة تمر"),
        title_i18n=i18n("Seasonal campaign", "Campagne saisonnière", "حملة موسمية"),
        description_i18n=i18n(
            "Pick an occasion, then describe or upload your product.",
            "Choisissez une occasion, puis décrivez ou importez votre produit.",
            "اختر مناسبة، ثم صف منتجك أو ارفعه.",
        ),
        slots=[
            prompt_slot(
                i18n("Describe your product", "Décrivez votre produit", "صِف منتجك"),
                placeholder=i18n("e.g. a box of dates", "ex. une boîte de dattes", "مثال: علبة تمر"),
                required=False,
            ),
        ],
        variants=_SEASONAL_VARIANTS,
        aspect_ratios=["1:1", "9:16"],
        default_n=2,
        tags=["ecommerce", "seasonal", "campaign", "studio", "freeform"],
    ),
    Pack(
        id="held-in-use",
        sector="ecommerce",
        order=6,
        capability="photoreal",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="the uploaded product held or being used in a natural human moment, candid, soft light, scale reference, high detail",
        example_i18n=i18n("a glass perfume bottle", "un flacon de parfum en verre", "زجاجة عطر زجاجية"),
        title_i18n=i18n("Held / in-use", "En main / en usage", "ممسوك / أثناء الاستخدام"),
        description_i18n=i18n(
            "Show your product held, worn, or being poured.",
            "Montrez votre produit tenu, porté ou versé.",
            "اعرض منتجك ممسوكًا أو مرتديًا أو يُسكب.",
        ),
        slots=[
            prompt_slot(
                i18n("Describe your product", "Décrivez votre produit", "صِف منتجك"),
                placeholder=i18n("e.g. a glass perfume bottle", "ex. un flacon de parfum", "مثال: زجاجة عطر"),
                required=False,
            ),
        ],
        variants=_HELD_VARIANTS,
        aspect_ratios=["4:5", "1:1"],
        default_n=2,
        tags=["ecommerce", "held", "in-use", "lifestyle", "studio", "freeform"],
    ),

    # ----------------------- 1.2  Food -----------------------
    Pack(
        id="dish-photography",
        sector="food",
        order=1,
        capability="photoreal",
        prompt_template=(
            "appetizing top-down food photography of {{dish}}, on {{surface}}, natural "
            "light, fresh ingredients, high detail"
        ),
        title_i18n=i18n("Dish photography", "Photo de plat", "تصوير الأطباق"),
        description_i18n=i18n(
            "Make any dish look freshly served and irresistible.",
            "Donnez à chaque plat un air fraîchement servi et irrésistible.",
            "اجعل أي طبق يبدو طازجًا ولا يُقاوَم.",
        ),
        slots=[
            text_slot("dish", i18n("Dish", "Plat", "الطبق"), required=True,
                      placeholder=i18n("e.g. grilled salmon", "ex. saumon grillé", "مثال: سمك مشوي")),
            select_slot("surface", i18n("Surface", "Surface", "السطح"), [
                opt("rustic wood", "rustic wood", "bois rustique", "خشب ريفي"),
                opt("marble", "marble", "marbre", "رخام"),
                opt("dark slate", "dark slate", "ardoise sombre", "حجر داكن"),
                opt("a woven placemat", "woven placemat", "set tressé", "مفرش منسوج"),
            ]),
        ],
        aspect_ratios=["1:1", "4:5"],
        default_n=4,
        tags=["food", "dish", "photography"],
    ),
    Pack(
        id="daily-special-post",
        sector="food",
        order=2,
        capability="text-in-image",
        prompt_template=(
            "social media food post of {{dish}}, vibrant, mouth-watering, with "
            "\"{{label}}\" text overlay {{price}}"
        ),
        title_i18n=i18n("Daily special post", "Plat du jour", "طبق اليوم"),
        description_i18n=i18n(
            "A ready-to-post special with room for your text.",
            "Un plat du jour prêt à publier avec votre texte.",
            "منشور طبق اليوم جاهز للنشر مع نصّك.",
        ),
        slots=[
            text_slot("dish", i18n("Dish", "Plat", "الطبق"), required=True),
            text_slot("label", i18n("Label", "Libellé", "العنوان"), required=True,
                      placeholder=i18n("e.g. Today's special", "ex. Plat du jour", "مثال: طبق اليوم")),
            text_slot("price", i18n("Price (optional)", "Prix (optionnel)", "السعر (اختياري)"),
                      placeholder=i18n("e.g. 12 DT", "ex. 12 DT", "مثال: ١٢ د")),
        ],
        aspect_ratios=["1:1", "9:16"],
        default_n=2,
        tags=["food", "social", "special", "text"],
    ),
    Pack(
        id="delivery-thumbnail",
        sector="food",
        order=3,
        capability="photoreal",
        prompt_template="clean menu thumbnail of {{dish}} on neutral background, well-lit, centered",
        title_i18n=i18n("Delivery-app thumbnail", "Vignette livraison", "صورة للتطبيق"),
        description_i18n=i18n(
            "Clean, centered menu thumbnails that pop in the app.",
            "Des vignettes nettes et centrées qui ressortent dans l'app.",
            "صور قائمة نظيفة ومتمركزة تبرز في التطبيق.",
        ),
        slots=[
            text_slot("dish", i18n("Dish", "Plat", "الطبق"), required=True),
        ],
        aspect_ratios=["1:1"],
        default_n=4,
        tags=["food", "delivery", "menu"],
    ),
    Pack(
        id="full-menu-board",
        sector="food",
        order=4,
        capability="text-in-image",
        prompt_template=(
            "elegant restaurant menu board titled \"{{restaurant}}\", listing: {{items}}, "
            "{{style}} style, legible, well-aligned text"
        ),
        title_i18n=i18n("Full menu board", "Tableau de menu", "قائمة الطعام"),
        description_i18n=i18n(
            "Turn your dish list into a designed menu image.",
            "Transformez votre liste de plats en un menu illustré.",
            "حوّل قائمة أطباقك إلى صورة قائمة مصمّمة.",
        ),
        slots=[
            text_slot("restaurant", i18n("Restaurant name", "Nom du restaurant", "اسم المطعم"), required=True),
            text_slot("items", i18n("Items", "Plats", "الأصناف"), required=True,
                      placeholder=i18n("e.g. couscous, tajine, brik", "ex. couscous, tajine, brik", "مثال: كسكسي، طاجين، بريك")),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("rustic chalkboard", "rustic chalkboard", "ardoise rustique", "سبورة ريفية"),
                opt("modern minimal", "modern minimal", "minimaliste moderne", "بسيط عصري"),
                opt("oriental ornate", "oriental ornate", "oriental orné", "زخرفي شرقي"),
            ]),
        ],
        aspect_ratios=["4:5", "9:16"],
        default_n=2,
        tags=["food", "menu", "text", "rtl"],
    ),
    Pack(
        id="cafe-ambiance-hero",
        sector="food",
        order=5,
        capability="photoreal",
        prompt_template=(
            "inviting interior photo of a {{type}}, {{time}} lighting, cozy, warm, "
            "inviting atmosphere"
        ),
        title_i18n=i18n("Cafe ambiance / hero", "Ambiance café", "أجواء المقهى"),
        description_i18n=i18n(
            "A warm interior hero shot for your page header.",
            "Une photo d'intérieur chaleureuse pour votre en-tête.",
            "صورة داخلية دافئة لترويسة صفحتك.",
        ),
        slots=[
            select_slot("type", i18n("Place type", "Type de lieu", "نوع المكان"), [
                opt("cafe", "cafe", "café", "مقهى"),
                opt("restaurant", "restaurant", "restaurant", "مطعم"),
                opt("bakery", "bakery", "boulangerie", "مخبزة"),
                opt("juice bar", "juice bar", "bar à jus", "بار عصائر"),
            ], required=True),
            select_slot("time", i18n("Light", "Lumière", "الإضاءة"), [
                opt("morning", "morning", "matin", "صباح"),
                opt("golden hour", "golden hour", "heure dorée", "ساعة ذهبية"),
                opt("evening", "evening", "soir", "مساء"),
            ]),
        ],
        aspect_ratios=["16:9", "4:5"],
        default_n=3,
        tags=["food", "interior", "hero"],
    ),

    # ----------------------- 1.3  Fashion -----------------------
    Pack(
        id="tshirt-design",
        sector="fashion",
        order=1,
        capability="vector-graphic",
        prompt_template=(
            "t-shirt graphic design of {{concept}} in {{style}} style, clean, print-ready, "
            "isolated on plain background"
        ),
        title_i18n=i18n("T-shirt design", "Design t-shirt", "تصميم تيشيرت"),
        description_i18n=i18n(
            "Turn an idea into a print-ready t-shirt graphic.",
            "Transformez une idée en visuel de t-shirt prêt à imprimer.",
            "حوّل فكرة إلى تصميم تيشيرت جاهز للطباعة.",
        ),
        slots=[
            text_slot("concept", i18n("Concept", "Concept", "الفكرة"), required=True,
                      placeholder=i18n("e.g. a lion with headphones", "ex. un lion avec un casque", "مثال: أسد بسماعات")),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("minimalist line art", "minimalist line art", "ligne minimaliste", "خطوط بسيطة"),
                opt("vintage retro", "vintage retro", "rétro vintage", "ريترو قديم"),
                opt("bold streetwear", "bold streetwear", "streetwear audacieux", "ستريت وير جريء"),
                opt("cute kawaii", "cute kawaii", "kawaii mignon", "كاواي لطيف"),
                opt("Arabic typographic", "Arabic typographic", "typographie arabe", "خط عربي"),
            ], required=True),
        ],
        aspect_ratios=["1:1"],
        default_n=4,
        tags=["fashion", "tshirt", "print", "vector"],
    ),
    Pack(
        id="mockup-on-model",
        sector="fashion",
        order=2,
        capability="edit-from-reference",
        prompt_template="photo of a model wearing a t-shirt with this design, {{setting}}, natural pose",
        title_i18n=i18n("Mockup on a model", "Sur mannequin", "على عارض"),
        description_i18n=i18n(
            "See your design worn by a real-looking model.",
            "Voyez votre design porté par un mannequin réaliste.",
            "شاهد تصميمك على عارض يبدو حقيقيًا.",
        ),
        slots=[
            select_slot("setting", i18n("Setting", "Cadre", "المكان"), [
                opt("a studio", "studio", "studio", "استوديو"),
                opt("a street", "street", "rue", "شارع"),
                opt("a cafe", "cafe", "café", "مقهى"),
            ], required=True),
        ],
        aspect_ratios=["4:5"],
        default_n=2,
        requires_image_input=True,
        tags=["fashion", "mockup", "model", "edit"],
    ),
    Pack(
        id="flat-lay-product",
        sector="fashion",
        order=3,
        capability="photoreal",
        prompt_template=(
            "flat-lay photo of {{garment}}, styled with {{props}}, {{palette}} palette, "
            "top-down, clean"
        ),
        title_i18n=i18n("Flat-lay product", "Mise à plat", "عرض مسطّح"),
        description_i18n=i18n(
            "A tidy flat-lay of your garment, styled with props.",
            "Une mise à plat soignée de votre vêtement, avec accessoires.",
            "عرض مسطّح أنيق لقطعتك مع إكسسوارات.",
        ),
        slots=[
            text_slot("garment", i18n("Garment", "Vêtement", "القطعة"), required=True,
                      placeholder=i18n("e.g. linen summer dress", "ex. robe d'été en lin", "مثال: فستان كتان صيفي")),
            text_slot("props", i18n("Props", "Accessoires", "الإكسسوارات"),
                      placeholder=i18n("e.g. sunglasses, sandals", "ex. lunettes, sandales", "مثال: نظارات، صندل")),
            select_slot("palette", i18n("Palette", "Palette", "الألوان"), PALETTE_OPTS),
        ],
        aspect_ratios=["1:1", "4:5"],
        default_n=3,
        tags=["fashion", "flatlay", "product"],
    ),
    Pack(
        id="seamless-textile-pattern",
        sector="fashion",
        order=4,
        capability="vector-graphic",
        prompt_template="seamless repeating textile pattern of {{motif}}, {{palette}} palette, tileable",
        title_i18n=i18n("Seamless textile pattern", "Motif textile", "نقش قماش"),
        description_i18n=i18n(
            "A tileable pattern you can print by the meter.",
            "Un motif répétable à imprimer au mètre.",
            "نقش قابل للتكرار للطباعة بالمتر.",
        ),
        slots=[
            text_slot("motif", i18n("Motif", "Motif", "الزخرفة"), required=True,
                      placeholder=i18n("e.g. small daisies", "ex. petites marguerites", "مثال: أقحوان صغير")),
            select_slot("palette", i18n("Palette", "Palette", "الألوان"), PALETTE_OPTS),
        ],
        aspect_ratios=["1:1"],
        default_n=3,
        tags=["fashion", "pattern", "textile", "vector"],
    ),

    # ----------------------- 1.4  Real estate -----------------------
    Pack(
        id="virtual-staging",
        sector="realestate",
        order=1,
        capability="edit-from-reference",
        prompt_template="the same room, professionally furnished in {{style}} style, realistic, well-lit",
        title_i18n=i18n("Virtual staging", "Home staging virtuel", "تأثيث افتراضي"),
        description_i18n=i18n(
            "Furnish an empty room in seconds.",
            "Meublez une pièce vide en quelques secondes.",
            "أثّث غرفة فارغة في ثوانٍ.",
        ),
        slots=[
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("modern", "modern", "moderne", "عصري"),
                opt("scandinavian", "scandinavian", "scandinave", "اسكندنافي"),
                opt("oriental", "oriental", "oriental", "شرقي"),
                opt("minimalist", "minimalist", "minimaliste", "بسيط"),
            ], required=True),
        ],
        aspect_ratios=["4:5", "16:9"],
        default_n=2,
        requires_image_input=True,
        tags=["realestate", "staging", "edit"],
    ),
    Pack(
        id="twilight-exterior",
        sector="realestate",
        order=2,
        capability="edit-from-reference",
        prompt_template="exterior photo of this house at dusk, warm window lights, dramatic twilight sky",
        title_i18n=i18n("Twilight exterior", "Façade au crépuscule", "واجهة عند الغروب"),
        description_i18n=i18n(
            "Turn a daytime listing photo into a dramatic dusk shot.",
            "Transformez une photo de jour en une vue spectaculaire au crépuscule.",
            "حوّل صورة نهارية إلى مشهد غروب آسر.",
        ),
        slots=[],
        aspect_ratios=["16:9"],
        default_n=2,
        requires_image_input=True,
        tags=["realestate", "twilight", "edit"],
    ),
    Pack(
        id="listing-banner",
        sector="realestate",
        order=3,
        capability="text-in-image",
        prompt_template=(
            "real estate listing banner for a {{property}}, \"{{status}}\" badge, {{price}}, "
            "clean modern layout, legible text"
        ),
        title_i18n=i18n("Listing banner", "Bannière d'annonce", "لافتة العقار"),
        description_i18n=i18n(
            "A polished for-sale / for-rent banner with the details on it.",
            "Une bannière à vendre / à louer soignée avec les détails.",
            "لافتة بيع أو كراء أنيقة مع التفاصيل.",
        ),
        slots=[
            text_slot("property", i18n("Property", "Bien", "العقار"), required=True,
                      placeholder=i18n("e.g. 3-room apartment", "ex. appartement 3 pièces", "مثال: شقة 3 غرف")),
            select_slot("status", i18n("Status", "Statut", "الحالة"), [
                opt("For sale", "For sale", "À vendre", "للبيع"),
                opt("For rent", "For rent", "À louer", "للكراء"),
            ], required=True),
            text_slot("price", i18n("Price", "Prix", "السعر"),
                      placeholder=i18n("e.g. 250,000 DT", "ex. 250 000 DT", "مثال: ٢٥٠٬٠٠٠ د")),
        ],
        aspect_ratios=["1:1", "16:9"],
        default_n=2,
        tags=["realestate", "banner", "text"],
    ),

    # ----------------------- 1.5  Social creators -----------------------
    # One freeform "studio" whose variants ARE the mockups. The Social sector in the
    # gallery renders these mockups directly (no category cards); picking one opens the
    # agent studio with the mockup uploaded as reference #1 (reproduced exactly) and its
    # scene text seeded into the editable prompt.
    Pack(
        id="social-profile-studio",
        sector="social",
        order=1,
        capability="edit-from-reference",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="recreate the reference social-media mockup exactly, replacing the placeholder photo and text with the user's photo and details, crisp legible text, high detail",
        title_i18n=i18n("Social studio", "Studio réseaux", "استوديو المحتوى"),
        description_i18n=i18n(
            "Pick a mockup, add your photo and details - we recreate it as yours.",
            "Choisissez un mockup, ajoutez votre photo et vos infos - recréé à votre nom.",
            "اختر مشهدًا، أضف صورتك وبياناتك - نعيد إنشاءه باسمك.",
        ),
        slots=[
            prompt_slot(
                i18n("Your name, handle & details", "Votre nom, @handle & infos", "اسمك و@المعرّف والتفاصيل"),
                placeholder=i18n(
                    "e.g. Amine Ouni, @amine.ouni, AI Creator, 128 posts, 42k followers",
                    "ex. Amine Ouni, @amine.ouni, AI Creator, 128 posts, 42k abonnés",
                    "مثال: أمين، @amine.ouni، صانع محتوى، ١٢٨ منشور، ٤٢ ألف متابع",
                ),
                required=False,
            ),
        ],
        variants=_SOCIAL_VARIANTS,
        aspect_ratios=["9:16", "4:5", "1:1"],
        default_n=1,
        requires_image_input=False,
        tags=["social", "profile", "mockup", "studio", "freeform", "new"],
    ),

    # ----------------------- 1.5b  Quote studio -----------------------
    # Like Social: one freeform "studio" whose variants ARE the quote-card mockups.
    # Mockup images are pending — variants stay empty for now, so the Quote sector
    # shows as "Soon" in the gallery (frontend UNLOCKED_SECTORS gate) until they land.
    Pack(
        id="quote-studio",
        sector="quote",
        order=1,
        capability="edit-from-reference",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="recreate the reference quote-card mockup exactly, replacing the placeholder text with the user's words, crisp legible typography, high detail",
        title_i18n=i18n("Quote studio", "Studio citations", "استوديو الاقتباسات"),
        description_i18n=i18n(
            "Pick a quote card, add your words - we recreate it as yours.",
            "Choisissez une carte de citation, ajoutez vos mots - recréée à votre nom.",
            "اختر بطاقة اقتباس، أضف كلماتك - نعيد إنشاءها باسمك.",
        ),
        slots=[
            prompt_slot(
                i18n("Your quote & author", "Votre citation & auteur", "اقتباسك واسم الكاتب"),
                placeholder=i18n(
                    "e.g. Work hard in silence, let your success make the noise. - Frank Ocean",
                    "ex. Travaillez dur en silence, laissez votre succès faire le bruit. - Frank Ocean",
                    "مثال: اعمل بصمت، ودع نجاحك يتكلّم. - فرانك أوشن",
                ),
                required=False,
            ),
        ],
        variants=_QUOTE_VARIANTS,
        aspect_ratios=["9:16", "4:5", "1:1"],
        default_n=1,
        requires_image_input=False,
        tags=["quote", "typography", "mockup", "studio", "freeform", "new"],
    ),

    # ----------------------- 1.5c  Digital products -----------------------
    # Like Social/Quote: one freeform "studio" whose variants ARE the promo-poster
    # mockups (subscription/streaming/game-topup/gift-card resale posters). The gallery
    # renders them directly; picking one opens the agent studio with the poster attached,
    # reproduced exactly with the user's product, prices and contact swapped in.
    Pack(
        id="digital-products-studio",
        sector="digital",
        order=1,
        capability="edit-from-reference",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="recreate the reference promotional poster exactly, replacing the product name, prices, features and contact with the user's details, crisp legible text, high detail",
        title_i18n=i18n("Digital products studio", "Studio produits digitaux", "استوديو المنتجات الرقمية"),
        description_i18n=i18n(
            "Pick a promo poster, add your product, price and contact - we recreate it as yours.",
            "Choisissez une affiche promo, ajoutez votre produit, prix et contact - recréée à votre nom.",
            "اختر ملصقًا ترويجيًا، أضف منتجك وسعرك وتواصلك - نعيد إنشاءه باسمك.",
        ),
        slots=[
            prompt_slot(
                i18n("Your product, price & contact", "Votre produit, prix & contact", "منتجك وسعرك وتواصلك"),
                placeholder=i18n(
                    "e.g. ChatGPT Plus, 12 months 40DT, DM to order",
                    "ex. ChatGPT Plus, 12 mois 40DT, MP pour commander",
                    "مثال: ChatGPT Plus، 12 شهر 40 دت، راسلنا للطلب",
                ),
                required=False,
            ),
        ],
        variants=_DIGITAL_VARIANTS,
        aspect_ratios=["4:5", "1:1", "9:16"],
        default_n=1,
        requires_image_input=False,
        tags=["digital", "subscription", "promo", "poster", "mockup", "studio", "freeform", "new"],
    ),

    # ----------------------- 1.6  Events / Weddings -----------------------
    Pack(
        id="invitation-card",
        sector="events",
        order=1,
        capability="text-in-image",
        prompt_template=(
            "elegant {{event}} invitation card, \"{{names}}\", {{date}}, {{style}} style, "
            "refined typography"
        ),
        title_i18n=i18n("Invitation card", "Carte d'invitation", "بطاقة دعوة"),
        description_i18n=i18n(
            "An elegant invitation with your names and date set in.",
            "Une invitation élégante avec vos noms et la date intégrés.",
            "بطاقة دعوة أنيقة بأسمائكم والتاريخ.",
        ),
        slots=[
            select_slot("event", i18n("Event", "Événement", "المناسبة"), [
                opt("wedding", "wedding", "mariage", "زفاف"),
                opt("engagement", "engagement", "fiançailles", "خطوبة"),
                opt("khitba", "khitba", "khitba", "خِطبة"),
                opt("birthday", "birthday", "anniversaire", "عيد ميلاد"),
                opt("graduation", "graduation", "remise de diplôme", "تخرّج"),
            ], required=True),
            text_slot("names", i18n("Names", "Noms", "الأسماء"), required=True),
            text_slot("date", i18n("Date", "Date", "التاريخ"), required=True),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("floral romantic", "floral romantic", "floral romantique", "زهري رومانسي"),
                opt("gold luxury", "gold luxury", "or luxueux", "ذهبي فاخر"),
                opt("modern minimal", "modern minimal", "minimaliste moderne", "بسيط عصري"),
                opt("oriental ornate", "oriental ornate", "oriental orné", "زخرفي شرقي"),
            ]),
        ],
        aspect_ratios=["4:5", "9:16"],
        default_n=2,
        tags=["events", "invitation", "text", "rtl"],
    ),
    Pack(
        id="save-the-date-story",
        sector="events",
        order=2,
        capability="text-in-image",
        prompt_template=(
            "save-the-date story graphic for {{event}}, \"{{names}}\", {{date}}, {{style}} "
            "style, vertical"
        ),
        title_i18n=i18n("Save-the-date / story", "Save the date", "احفظ التاريخ"),
        description_i18n=i18n(
            "A vertical announcement made for Stories.",
            "Une annonce verticale pensée pour les Stories.",
            "إعلان عمودي مصمّم للستوري.",
        ),
        slots=[
            select_slot("event", i18n("Event", "Événement", "المناسبة"), [
                opt("wedding", "wedding", "mariage", "زفاف"),
                opt("engagement", "engagement", "fiançailles", "خطوبة"),
                opt("birthday", "birthday", "anniversaire", "عيد ميلاد"),
            ], required=True),
            text_slot("names", i18n("Names", "Noms", "الأسماء"), required=True),
            text_slot("date", i18n("Date", "Date", "التاريخ"), required=True),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("floral romantic", "floral romantic", "floral romantique", "زهري رومانسي"),
                opt("gold luxury", "gold luxury", "or luxueux", "ذهبي فاخر"),
                opt("modern minimal", "modern minimal", "minimaliste moderne", "بسيط عصري"),
            ]),
        ],
        aspect_ratios=["9:16"],
        default_n=2,
        tags=["events", "story", "text"],
    ),
    Pack(
        id="event-backdrop",
        sector="events",
        order=3,
        capability="photoreal",
        prompt_template=(
            "event backdrop design for a {{event}}, {{palette}} palette, {{theme}} theme, "
            "balloons and florals"
        ),
        title_i18n=i18n("Themed backdrop", "Déco d'événement", "ديكور المناسبة"),
        description_i18n=i18n(
            "Preview a styled backdrop for your event.",
            "Prévisualisez un décor stylé pour votre événement.",
            "عاين خلفية مصمّمة لمناسبتك.",
        ),
        slots=[
            select_slot("event", i18n("Event", "Événement", "المناسبة"), [
                opt("wedding", "wedding", "mariage", "زفاف"),
                opt("birthday", "birthday", "anniversaire", "عيد ميلاد"),
                opt("baby shower", "baby shower", "baby shower", "استقبال مولود"),
            ], required=True),
            select_slot("palette", i18n("Palette", "Palette", "الألوان"), PALETTE_OPTS),
            text_slot("theme", i18n("Theme", "Thème", "الفكرة"),
                      placeholder=i18n("e.g. boho garden", "ex. jardin bohème", "مثال: حديقة بوهيمية")),
        ],
        aspect_ratios=["16:9", "1:1"],
        default_n=3,
        tags=["events", "backdrop", "decor"],
    ),
    Pack(
        id="thank-you-card",
        sector="events",
        order=4,
        capability="text-in-image",
        prompt_template="elegant thank-you card, \"{{message}}\", {{style}} style, refined typography",
        title_i18n=i18n("Thank-you card", "Carte de remerciement", "بطاقة شكر"),
        description_i18n=i18n(
            "A matching thank-you card to close the celebration.",
            "Une carte de remerciement assortie pour clôturer la fête.",
            "بطاقة شكر منسّقة لختام الاحتفال.",
        ),
        slots=[
            text_slot("message", i18n("Message", "Message", "الرسالة"), required=True,
                      placeholder=i18n("e.g. Thank you for celebrating with us", "ex. Merci d'avoir célébré avec nous", "مثال: شكرًا لمشاركتكم فرحتنا")),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("floral romantic", "floral romantic", "floral romantique", "زهري رومانسي"),
                opt("gold luxury", "gold luxury", "or luxueux", "ذهبي فاخر"),
                opt("modern minimal", "modern minimal", "minimaliste moderne", "بسيط عصري"),
            ]),
        ],
        aspect_ratios=["1:1", "4:5"],
        default_n=2,
        tags=["events", "thankyou", "text"],
    ),

    # ----------------------- 1.7  Beauty -----------------------
    Pack(
        id="service-menu",
        sector="beauty",
        order=1,
        capability="text-in-image",
        prompt_template=(
            "elegant beauty salon service list titled \"{{name}}\", services: {{services}}, "
            "{{style}} style, legible prices"
        ),
        title_i18n=i18n("Service menu / price list", "Carte des prestations", "قائمة الخدمات"),
        description_i18n=i18n(
            "Your services and prices, designed into one clean image.",
            "Vos prestations et prix, dans une image nette et soignée.",
            "خدماتك وأسعارك في صورة واحدة أنيقة.",
        ),
        slots=[
            text_slot("name", i18n("Salon name", "Nom du salon", "اسم الصالون"), required=True),
            text_slot("services", i18n("Services", "Prestations", "الخدمات"), required=True,
                      placeholder=i18n("e.g. haircut, color, manicure", "ex. coupe, couleur, manucure", "مثال: قص، صبغة، مانيكير")),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("soft pink", "soft pink", "rose doux", "وردي ناعم"),
                opt("luxury gold", "luxury gold", "or luxueux", "ذهبي فاخر"),
                opt("clean modern", "clean modern", "moderne épuré", "عصري نظيف"),
            ]),
        ],
        aspect_ratios=["4:5", "9:16"],
        default_n=2,
        tags=["beauty", "menu", "text", "rtl"],
    ),
    Pack(
        id="before-after-frame",
        sector="beauty",
        order=2,
        capability="edit-from-reference",
        prompt_template="professional before-and-after split layout from this result, \"{{label}}\" caption, clean",
        title_i18n=i18n("Before / after frame", "Avant / après", "قبل / بعد"),
        description_i18n=i18n(
            "A clean split-frame to showcase a result.",
            "Un cadre comparatif net pour montrer un résultat.",
            "إطار مقارنة نظيف لإبراز النتيجة.",
        ),
        slots=[
            text_slot("label", i18n("Caption", "Légende", "التعليق"),
                      placeholder=i18n("e.g. 4 weeks result", "ex. résultat en 4 semaines", "مثال: نتيجة 4 أسابيع")),
        ],
        aspect_ratios=["1:1", "4:5"],
        default_n=1,
        requires_image_input=True,
        tags=["beauty", "before-after", "edit"],
    ),
    Pack(
        id="beauty-promo-post",
        sector="beauty",
        order=3,
        capability="text-in-image",
        prompt_template="beauty promo post for {{service}}, \"{{offer}}\", {{mood}}, elegant",
        title_i18n=i18n("Promo / offer post", "Offre promo", "عرض ترويجي"),
        description_i18n=i18n(
            "A polished promo for a treatment or package.",
            "Une promo soignée pour un soin ou un forfait.",
            "إعلان أنيق لخدمة أو باقة.",
        ),
        slots=[
            text_slot("service", i18n("Service", "Prestation", "الخدمة"), required=True,
                      placeholder=i18n("e.g. facial treatment", "ex. soin du visage", "مثال: عناية بالوجه")),
            text_slot("offer", i18n("Offer", "Offre", "العرض"), required=True,
                      placeholder=i18n("e.g. -20% this week", "ex. -20% cette semaine", "مثال: -٢٠٪ هذا الأسبوع")),
            select_slot("mood", i18n("Mood", "Ambiance", "الأجواء"), [
                opt("spa calm", "spa calm", "spa apaisant", "هدوء سبا"),
                opt("glam gold", "glam gold", "glamour doré", "غلام ذهبي"),
                opt("fresh clean", "fresh clean", "frais et net", "منعش ونظيف"),
            ]),
        ],
        aspect_ratios=["1:1", "9:16"],
        default_n=2,
        tags=["beauty", "promo", "text"],
    ),
    Pack(
        id="clinic-hero",
        sector="beauty",
        order=4,
        capability="photoreal",
        prompt_template="clean professional photo for a {{type}} clinic, {{mood}}, trustworthy, bright",
        title_i18n=i18n("Clinic / treatment hero", "Visuel clinique", "صورة العيادة"),
        description_i18n=i18n(
            "A reassuring, professional header image.",
            "Une image d'en-tête professionnelle et rassurante.",
            "صورة ترويسة مهنية تبعث على الطمأنينة.",
        ),
        slots=[
            select_slot("type", i18n("Clinic type", "Type de clinique", "نوع العيادة"), [
                opt("dental", "dental", "dentaire", "أسنان"),
                opt("dermatology", "dermatology", "dermatologie", "جلدية"),
                opt("physiotherapy", "physiotherapy", "kinésithérapie", "علاج طبيعي"),
            ], required=True),
            select_slot("mood", i18n("Mood", "Ambiance", "الأجواء"), [
                opt("calm", "calm", "calme", "هادئ"),
                opt("modern", "modern", "moderne", "عصري"),
                opt("warm", "warm", "chaleureux", "دافئ"),
            ]),
        ],
        aspect_ratios=["16:9", "4:5"],
        default_n=3,
        tags=["beauty", "clinic", "hero"],
    ),

    # ----------------------- 1.8  Arabic-first / Local (full trilingual) -----------------------
    Pack(
        id="arabic-calligraphy-art",
        sector="arabic",
        order=1,
        capability="calligraphy",
        prompt_template=(
            "Arabic calligraphy of \"{{text}}\" in {{script}} script, {{style}} composition, "
            "{{palette}}, elegant, centered"
        ),
        title_i18n=i18n("Arabic calligraphy art", "Calligraphie arabe", "لوحة خط عربي"),
        description_i18n=i18n(
            "Turn a word or verse into a framed calligraphy piece.",
            "Transformez un mot en œuvre calligraphique.",
            "حوّل كلمة أو آية إلى لوحة خط جاهزة.",
        ),
        slots=[
            text_slot("text", i18n("Text", "Texte", "النص"), required=True,
                      placeholder=i18n("e.g. peace", "ex. paix", "مثال: سلام")),
            select_slot("script", i18n("Script", "Style d'écriture", "نوع الخط"), [
                opt("Diwani", "Diwani", "Diwani", "ديواني"),
                opt("Thuluth", "Thuluth", "Thuluth", "ثلث"),
                opt("Naskh", "Naskh", "Naskh", "نسخ"),
                opt("Kufic", "Kufic", "Kufic", "كوفي"),
                opt("modern", "modern", "moderne", "حديث"),
            ], required=True),
            select_slot("style", i18n("Composition", "Composition", "التكوين"), [
                opt("classic framed", "classic framed", "encadré classique", "إطار كلاسيكي"),
                opt("modern minimal", "modern minimal", "minimaliste moderne", "بسيط حديث"),
                opt("gold on dark", "gold on dark", "or sur fond sombre", "ذهبي على داكن"),
                opt("zellige border", "zellige border", "bordure zellige", "إطار زليج"),
            ]),
            select_slot("palette", i18n("Palette", "Palette", "الألوان"), [
                opt("gold and navy", "gold and navy", "or et bleu nuit", "ذهبي وكحلي"),
                opt("black and white", "black and white", "noir et blanc", "أبيض وأسود"),
                opt("emerald and gold", "emerald and gold", "émeraude et or", "زمردي وذهبي"),
            ]),
        ],
        aspect_ratios=["1:1", "4:5", "9:16"],
        default_n=2,
        tags=["arabic", "calligraphy", "rtl"],
    ),
    Pack(
        id="ramadan-eid-campaign",
        sector="arabic",
        order=2,
        capability="text-in-image",
        prompt_template=(
            "{{occasion}} themed greeting, \"{{greeting}}\" in Arabic, crescent and lantern "
            "motifs, {{palette}}, festive"
        ),
        title_i18n=i18n("Ramadan & Eid campaign", "Campagne Ramadan & Aïd", "حملة رمضان والعيد"),
        description_i18n=i18n(
            "A festive greeting or promo in authentic Ramadan style.",
            "Un vœu ou une promo festifs au style ramadanesque authentique.",
            "تهنئة أو إعلان بأجواء رمضانية أصيلة.",
        ),
        slots=[
            select_slot("occasion", i18n("Occasion", "Occasion", "المناسبة"), [
                opt("Ramadan Kareem", "Ramadan Kareem", "Ramadan Kareem", "رمضان كريم"),
                opt("Eid al-Fitr", "Eid al-Fitr", "Aïd el-Fitr", "عيد الفطر"),
                opt("Eid al-Adha", "Eid al-Adha", "Aïd el-Adha", "عيد الأضحى"),
            ], required=True),
            text_slot("greeting", i18n("Greeting", "Vœu", "التهنئة"), required=True,
                      placeholder=i18n("e.g. Ramadan Kareem", "ex. Ramadan Kareem", "مثال: رمضان كريم")),
            select_slot("palette", i18n("Palette", "Palette", "الألوان"), [
                opt("gold and navy", "gold and navy", "or et bleu nuit", "ذهبي وكحلي"),
                opt("emerald and gold", "emerald and gold", "émeraude et or", "زمردي وذهبي"),
                opt("purple night", "purple night", "nuit violette", "ليلي بنفسجي"),
            ]),
        ],
        aspect_ratios=["1:1", "9:16", "4:5"],
        default_n=4,
        tags=["arabic", "ramadan", "eid", "text", "rtl"],
    ),
    Pack(
        id="shop-sign-concept",
        sector="arabic",
        order=3,
        capability="vector-graphic",
        prompt_template=(
            "shop sign / logo concept for \"{{name}}\", bilingual Arabic and Latin, "
            "{{business}} type, {{style}} style"
        ),
        title_i18n=i18n("Shop sign concept", "Enseigne de boutique", "لافتة محل"),
        description_i18n=i18n(
            "A bilingual sign or logo concept for your shop.",
            "Un concept d'enseigne ou de logo bilingue pour votre boutique.",
            "فكرة لافتة أو شعار لمحلّك بالعربية والفرنسية.",
        ),
        slots=[
            text_slot("name", i18n("Name", "Nom", "الاسم"), required=True),
            text_slot("business", i18n("Business type", "Type de commerce", "نوع النشاط"), required=True,
                      placeholder=i18n("e.g. cafe, barber", "ex. café, barbier", "مثال: مقهى، حلّاق")),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("modern", "modern", "moderne", "عصري"),
                opt("traditional", "traditional", "traditionnel", "تقليدي"),
                opt("neon", "neon", "néon", "نيون"),
                opt("vintage", "vintage", "vintage", "قديم"),
            ]),
        ],
        aspect_ratios=["1:1", "16:9"],
        default_n=3,
        tags=["arabic", "sign", "logo", "vector"],
    ),
    Pack(
        id="oriental-pattern",
        sector="arabic",
        order=4,
        capability="vector-graphic",
        prompt_template=(
            "seamless oriental {{motif}} pattern, {{palette}} palette, geometric, tileable, "
            "zellige-inspired"
        ),
        title_i18n=i18n("Oriental pattern", "Motif oriental", "زخرفة عربية"),
        description_i18n=i18n(
            "A tileable Islamic / zellige pattern for any backdrop.",
            "Un motif islamique / zellige répétable pour tout fond.",
            "نقش عربي قابل للتكرار لأي خلفية.",
        ),
        slots=[
            select_slot("motif", i18n("Motif", "Motif", "الزخرفة"), [
                opt("zellige geometric", "zellige geometric", "zellige géométrique", "زليج هندسي"),
                opt("arabesque floral", "arabesque floral", "arabesque florale", "أرابيسك زهري"),
                opt("mashrabiya", "mashrabiya", "moucharabieh", "مشربية"),
            ], required=True),
            select_slot("palette", i18n("Palette", "Palette", "الألوان"), [
                opt("blue and white", "blue and white", "bleu et blanc", "أزرق وأبيض"),
                opt("gold and green", "gold and green", "or et vert", "ذهبي وأخضر"),
                opt("terracotta", "terracotta", "terre cuite", "طيني"),
            ]),
        ],
        aspect_ratios=["1:1"],
        default_n=3,
        tags=["arabic", "pattern", "zellige", "vector"],
    ),
    Pack(
        id="occasion-greeting",
        sector="arabic",
        order=5,
        capability="calligraphy",
        prompt_template=(
            "Arabic greeting card for {{occasion}}, \"{{message}}\", {{style}} style, "
            "respectful and elegant"
        ),
        title_i18n=i18n("Occasion greeting", "Carte de vœux", "بطاقة تهنئة"),
        description_i18n=i18n(
            "A heartfelt card for Mawlid, Friday, or any occasion.",
            "Une carte chaleureuse pour le Mawlid, le vendredi ou toute occasion.",
            "بطاقة تهنئة للمولد أو الجمعة أو أي مناسبة.",
        ),
        slots=[
            select_slot("occasion", i18n("Occasion", "Occasion", "المناسبة"), [
                opt("Jumu'ah", "Jumu'ah (Friday)", "Joumoua (vendredi)", "الجمعة"),
                opt("Mawlid", "Mawlid", "Mawlid", "المولد"),
                opt("New Hijri Year", "New Hijri Year", "Nouvel an hégirien", "رأس السنة الهجرية"),
                opt("a special occasion", "Generic", "Générique", "مناسبة عامة"),
            ], required=True),
            text_slot("message", i18n("Message", "Message", "الرسالة"), required=True,
                      placeholder=i18n("e.g. Blessed Friday", "ex. Vendredi béni", "مثال: جمعة مباركة")),
            select_slot("style", i18n("Style", "Style", "النمط"), [
                opt("classic framed", "classic framed", "encadré classique", "إطار كلاسيكي"),
                opt("gold on dark", "gold on dark", "or sur fond sombre", "ذهبي على داكن"),
                opt("floral", "floral", "floral", "زهري"),
            ]),
        ],
        aspect_ratios=["1:1", "4:5"],
        default_n=2,
        tags=["arabic", "greeting", "calligraphy", "rtl"],
    ),

    # ----------------------- Variant/studio demo: T-shirt mockups -----------------------
    # Freeform studio: pick a mockup scene, then write a 4k prompt + optionally
    # upload your design (routes to an image-edit model when uploaded).
    Pack(
        id="tshirt-studio",
        sector="fashion",
        order=10,
        capability="photoreal",
        kind="freeform",
        prompt_template="{{prompt}}",
        default_prompt="a t-shirt with the uploaded design, professional product photo, clean",
        title_i18n=i18n("T-shirt studio", "Studio t-shirt", "استوديو التيشيرت"),
        description_i18n=i18n(
            "Pick a mockup scene, then describe or upload your design.",
            "Choisissez une scène de mockup, puis décrivez ou importez votre design.",
            "اختر مشهد عرض، ثم صف تصميمك أو ارفعه.",
        ),
        slots=[
            prompt_slot(
                i18n("Describe your t-shirt", "Décrivez votre t-shirt", "صِف تيشيرتك"),
                placeholder=i18n(
                    "e.g. a minimalist line-art lion, black on white",
                    "ex. un lion en ligne minimaliste, noir sur blanc",
                    "مثال: أسد بخطوط بسيطة، أسود على أبيض",
                ),
                required=False,  # may rely on the uploaded design + scene
            ),
        ],
        variants=[
            Variant("on-wood", i18n("On a wooden surface", "Sur bois", "على سطح خشبي"),
                    "a t-shirt laid flat on a warm wooden surface, top-down, natural light, high detail",
                    "/mockups/tshirt/on-wood.png", "/mockups/tshirt/on-wood.png"),
            Variant("worn-model", i18n("Worn by a model", "Porté par un mannequin", "يرتديه عارض"),
                    "a t-shirt worn by a model, natural pose, soft studio light",
                    "/mockups/tshirt/worn-model.png", "/mockups/tshirt/worn-model.png"),
            Variant("folded", i18n("Folded", "Plié", "مطوي"),
                    "a neatly folded t-shirt on a soft pastel background, clean product shot",
                    "/mockups/tshirt/folded.png", "/mockups/tshirt/folded.png"),
            Variant("brick-wall", i18n("On a brick wall", "Sur mur de briques", "على جدار طوب"),
                    "a t-shirt on a hanger against a rustic exposed-brick wall, urban, side light",
                    "/mockups/tshirt/brick-wall.png", "/mockups/tshirt/brick-wall.png"),
            Variant("styled-rack", i18n("Styled rack", "Sur portant stylé", "على رف منسّق"),
                    "a t-shirt hanging on a wooden ladder rack by a gray wall, styled with a plant and accessories, lifestyle",
                    "/mockups/tshirt/styled-rack.png", "/mockups/tshirt/styled-rack.png"),
            Variant("bright-room", i18n("Bright room", "Pièce lumineuse", "غرفة مضيئة"),
                    "a t-shirt hanging on a white rack in a bright minimal room with a plant, airy daylight",
                    "/mockups/tshirt/bright-room.png", "/mockups/tshirt/bright-room.png"),
            Variant("outdoor", i18n("Outdoor", "Extérieur", "في الخارج"),
                    "a t-shirt hanging outdoors in a sunny boho patio with plants and a straw hat, warm daylight",
                    "/mockups/tshirt/outdoor.png", "/mockups/tshirt/outdoor.png"),
            Variant("boutique", i18n("In a boutique", "En boutique", "في متجر"),
                    "a t-shirt displayed on a mannequin in a modern clothing boutique, retail lighting",
                    "/mockups/tshirt/boutique.png", "/mockups/tshirt/boutique.png"),
        ],
        aspect_ratios=["1:1", "4:5", "16:9"],
        default_n=2,
        tags=["fashion", "tshirt", "studio", "mockup", "freeform"],
    ),
]


def all_packs() -> List[Pack]:
    return list(PACKS)


def get_pack(pack_id: str) -> Optional[Pack]:
    for p in PACKS:
        if p.id == pack_id:
            return p
    return None


# Gallery sector ordering (market priority); sectors not listed sort after.
SECTOR_ORDER = ["ecommerce", "social", "quote", "digital", "food", "fashion", "realestate", "events", "beauty", "arabic"]


def list_packs(sector: Optional[str] = None) -> List[Pack]:
    """Enabled packs, optionally filtered by sector, ordered for display."""
    out = [p for p in PACKS if p.enabled and (sector is None or p.sector == sector)]

    def sort_key(p: Pack):
        si = SECTOR_ORDER.index(p.sector) if p.sector in SECTOR_ORDER else len(SECTOR_ORDER)
        return (si, p.order)

    out.sort(key=sort_key)
    return out
