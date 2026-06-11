"use client";

import Link from "next/link";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";

const policyLocales = {
  en: {
    header: {
      label: "Usage Policy",
      title: "The operating rules for Vibecraft accounts, credits, billing, and content generation.",
      desc: "This page defines the current production rules for account behavior, usage ceilings, acceptable use, credit billing, redemption controls, and suspension handling on Vibecraft.",
    },
    effective: {
      label: "Effective",
      date: "April 24, 2026",
      desc: "This policy applies to the current Vibecraft production workflow unless replaced by a later revision.",
    },
    support: {
      label: "Support",
      email: "ouni@novanode.tn",
      desc: "Billing disputes, suspension appeals, and policy questions should be sent to the current Vibecraft support contact.",
    },
    footer: {
      label: "Important note",
      title: "This page governs use of the service.",
      desc: "Account rules, billing, acceptable use, enforcement, and suspension outcomes are documented here. Data collection, processing, and retention are covered separately in the Privacy Policy.",
    },
    sections: [
      {
        title: "Account Rules",
        summary: "Core identity and access rules for using Vibecraft.",
        items: [
          "Each person should use one primary account.",
          "Accounts may not be created in bulk to bypass credit or usage limits.",
          "You are responsible for activity performed through your account.",
          "Accounts may be limited, suspended, or manually reviewed if abuse, fraud, or account sharing is detected.",
        ],
      },
      {
        title: "Usage Limits",
        summary: "The current service ceilings used to control cost and abuse exposure.",
        items: [
          "First 24 hours after signup: maximum 1 credit total usage.",
          "After the first 24 hours: maximum 5 credits per rolling 24 hours.",
          "Smart analysis fees, generation charges, and plain-chat billed usage all count toward account usage.",
          "Operator-side safety, credit, abuse, or provider limits may block requests before a requested action runs.",
        ],
      },
      {
        title: "Credits, Billing, And Refund Rules",
        summary: "How credits are consumed and when a charge should or should not happen.",
        items: [
          "Vibecraft charges credits based on the active billing logic of the selected workflow or model.",
          "If Vibecraft cannot deliver a usable result, the user should not be charged for that failed result unless otherwise stated in-product.",
          "If a request succeeds and provider cost is already incurred, the delivered result may still be charged even if the final account balance becomes slightly negative.",
          "Standard Vibecraft credits do not expire unless a specific promotional credit explicitly says otherwise.",
          "Credits are non-transferable and are not intended to be traded, resold, or pooled across accounts.",
        ],
      },
      {
        title: "Credit Code Rules",
        summary: "Redemption rules, anti-bruteforce thresholds, and consequences for repeated failed attempts.",
        items: [
          "No account may redeem more than 4 credit codes in 1 day.",
          "No account may redeem more than 10 credit codes in 7 days.",
          "If an account reaches 5 failed credit-code attempts in 5 minutes, redemption is blocked for 5 minutes.",
          "10 consecutive failed credit-code attempts can trigger a 1-hour suspension.",
          "20 consecutive failed credit-code attempts within 24 hours can trigger suspension until admin review.",
          "Credit codes may not be abused through multi-account farming or brute-force attempts.",
        ],
      },
      {
        title: "Acceptable Use And Prohibited Content",
        summary: "The baseline content and platform-abuse rules that apply across chat, quick, and smart workflows.",
        items: [
          "No explicit sexual or pornographic content.",
          "No exploitative, abusive, hateful, fraudulent, or illegal content.",
          "No attempts to abuse the platform, bypass moderation, or attack providers.",
          "Do not upload content you do not have the right to use, process, transform, or generate from.",
          "Do not use Vibecraft for spam, credential attacks, provider probing, scraping, or automated abuse.",
        ],
      },
      {
        title: "Enforcement And Suspension",
        summary: "What may happen if these rules are violated.",
        items: [
          "Enforcement may include warnings, temporary restrictions, credit-code blocks, generation blocks, suspension, or permanent removal.",
          "Serious fraud, brute-force behavior, multi-account farming, or provider abuse may trigger immediate suspension without prior warning.",
          "The operator may review logs, billing records, generation history, and abuse signals when investigating violations.",
        ],
      },
      {
        title: "Output Disclaimer And Appeals",
        summary: "What Vibecraft does not guarantee and how disputes should be escalated.",
        items: [
          "Generated outputs may be inaccurate, incomplete, biased, or unsuitable for legal, medical, financial, or other high-stakes decisions.",
          "You are responsible for reviewing and validating outputs before publishing, selling, or relying on them.",
          "If you believe an enforcement action or billing outcome is incorrect, contact Vibecraft Support at ouni@novanode.tn.",
        ],
      },
    ],
  },
  fr: {
    header: {
      label: "Conditions d'Utilisation",
      title: "Règles de fonctionnement des comptes, crédits, facturation et génération de contenu sur Vibecraft.",
      desc: "Cette page définit les règles de production actuelles pour le comportement des comptes, les plafonds d'utilisation, l'utilisation acceptable, la facturation des crédits, les contrôles de réclamation et la gestion des suspensions sur Vibecraft.",
    },
    effective: {
      label: "Date d'effet",
      date: "24 Avril 2026",
      desc: "Cette politique s'applique au workflow de production actuel de Vibecraft à moins d'être remplacée par une révision ultérieure.",
    },
    support: {
      label: "Assistance",
      email: "ouni@novanode.tn",
      desc: "Les litiges de facturation, les appels de suspension et les questions de politique doivent être envoyés au contact d'assistance actuel de Vibecraft.",
    },
    footer: {
      label: "Note importante",
      title: "Cette page régit l'utilisation du service.",
      desc: "Les règles de compte, la facturation, l'utilisation acceptable, l'application et les résultats des suspensions sont documentés ici. La collecte, le traitement et la conservation des données sont couverts séparément dans la Politique de Confidentialité.",
    },
    sections: [
      {
        title: "Règles des Comptes",
        summary: "Règles fondamentales d'identité et d'accès pour l'utilisation de Vibecraft.",
        items: [
          "Chaque personne doit utiliser un seul compte principal.",
          "Les comptes ne peuvent pas être créés en masse pour contourner les limites de crédit ou d'utilisation.",
          "Vous êtes responsable des activités effectuées via votre compte.",
          "Les comptes peuvent être limités, suspendus ou examinés manuellement si des abus, des fraudes ou le partage de compte sont détectés.",
        ],
      },
      {
        title: "Limites d'Utilisation",
        summary: "Les plafonds de service actuels utilisés pour contrôler les coûts et l'exposition aux abus.",
        items: [
          "Les 24 premières heures après l'inscription : maximum 1 crédit d'utilisation totale.",
          "Après les 24 premières heures : maximum 5 crédits par période de 24 heures glissantes.",
          "Les frais d'analyse intelligente, les frais de génération et l'utilisation facturée du chat simple comptent tous dans l'utilisation du compte.",
          "Les limites de sécurité, de crédit, d'abus ou de fournisseur côté opérateur peuvent bloquer les requêtes avant l'exécution d'une action demandée.",
        ],
      },
      {
        title: "Crédits, Facturation et Règles de Remboursement",
        summary: "Comment les crédits sont consommés et quand des frais doivent ou ne doivent pas être appliqués.",
        items: [
          "Vibecraft facture des crédits en fonction de la logique de facturation active du workflow ou du modèle sélectionné.",
          "Si Vibecraft ne peut pas fournir un résultat utilisable, l'utilisateur ne doit pas être facturé pour cet échec de génération, sauf indication contraire dans le produit.",
          "Si une demande réussit et qu'un coût fournisseur est déjà engagé, le résultat livré reste facturable même si le solde final du compte devient légèrement négatif.",
          "Les crédits Vibecraft standard n'expirent pas, à moins qu'un crédit promotionnel spécifique ne dise explicitement le contraire.",
          "Les crédits sont non transférables et ne sont pas destinés à être échangés, revendus ou mis en commun entre les comptes.",
        ],
      },
      {
        title: "Règles des Codes de Crédit",
        summary: "Règles de réclamation, seuils anti-bruteforce et conséquences pour les tentatives échouées répétées.",
        items: [
          "Aucun compte ne peut réclamer plus de 4 codes de crédit en 1 jour.",
          "Aucun compte ne peut réclamer plus de 10 codes de crédit en 7 jours.",
          "Si un compte atteint 5 tentatives de code de crédit échouées en 5 minutes, la réclamation est bloquée pendant 5 minutes.",
          "10 tentatives échouées consécutives peuvent déclencher une suspension de 1 heure.",
          "20 tentatives échouées consécutives dans un délai de 24 heures peuvent déclencher une suspension jusqu'à examen administratif.",
          "Les codes de crédit ne doivent pas être abusés par le biais de la création de comptes multiples ou de tentatives par force brute.",
        ],
      },
      {
        title: "Utilisation Acceptable et Contenu Interdit",
        summary: "Le contenu de base et les règles d'abus de plate-forme qui s'appliquent aux workflows de chat, rapides et intelligents.",
        items: [
          "Aucun contenu sexuel ou pornographique explicite.",
          "Aucun contenu exploitant, abusif, haineux, frauduleux ou illégal.",
          "Aucune tentative d'abuser de la plateforme, de contourner la modération ou d'attaquer les fournisseurs.",
          "Ne téléchargez pas de contenu que vous n'avez pas le droit d'utiliser, de traiter, de transformer ou à partir duquel générer.",
          "N'utilisez pas Vibecraft pour le spam, les attaques par force brute sur les identifiants, le sondage de fournisseurs, le web scraping ou les abus automatisés.",
        ],
      },
      {
        title: "Application et Suspension",
        summary: "Que peut-il se passer si ces règles sont violées.",
        items: [
          "L'application peut inclure des avertissements, des restrictions temporaires, des blocages de code de crédit, des blocages de génération, des suspensions ou des suppressions permanentes.",
          "Une fraude grave, un comportement de force brute, l'exploitation de plusieurs comptes ou l'abus de fournisseurs peuvent déclencher une suspension immédiate sans avertissement préalable.",
          "L'opérateur peut examiner les journaux, les dossiers de facturation, l'historique de génération et les signaux d'abus lors de l'enquête sur les violations.",
        ],
      },
      {
        title: "Avis de non-responsabilité et Appels",
        summary: "Ce que Vibecraft ne garantit pas et la gestion des litiges.",
        items: [
          "Les résultats générés peuvent être inexacts, incomplets, biaisés ou inappropriés pour des décisions juridiques, médicales, financières ou d'autres décisions à enjeux élevés.",
          "Vous êtes responsable de l'examen et de la validation des résultats avant de les publier, de les vendre ou de vous y fier.",
          "Si vous pensez qu'une mesure d'application ou un résultat de facturation est incorrect, contactez le support de Vibecraft à ouni@novanode.tn.",
        ],
      },
    ],
  },
  ar: {
    header: {
      label: "سياسة الاستخدام",
      title: "قواعد التشغيل لحسابات Vibecraft، الأرصدة، الفوترة، وإنشاء المحتوى.",
      desc: "تُحدد هذه الصفحة قواعد التشغيل الحالية لسلوك الحساب، حدود الاستخدام، الاستخدام المقبول، فوترة الأرصدة، ضوابط الاسترداد، ومعالجة التعليق على Vibecraft.",
    },
    effective: {
      label: "تاريخ السريان",
      date: "24 أبريل 2026",
      desc: "تنطبق هذه السياسة على سير عمل إنتاج Vibecraft الحالي ما لم يتم استبدالها بمراجعة لاحقة.",
    },
    support: {
      label: "الدعم الفني",
      email: "ouni@novanode.tn",
      desc: "يجب إرسال نزاعات الفوترة، وطعون التعليق، وأسئلة السياسة إلى جهة اتصال الدعم الحالية في Vibecraft.",
    },
    footer: {
      label: "ملاحظة هامة",
      title: "هذه الصفحة تحكم استخدام الخدمة.",
      desc: "تم توثيق قواعد الحساب، والفوترة، والاستخدام المقبول، والإنفاذ، ونتائج التعليق هنا. يتم تغطية جمع البيانات ومعالجتها والاحتفاظ بها بشكل منفصل في سياسة الخصوصية.",
    },
    sections: [
      {
        title: "قواعد الحسابات",
        summary: "قواعد الهوية الأساسية والوصول لاستخدام Vibecraft.",
        items: [
          "يجب على كل شخص استخدام حساب رئيسي واحد.",
          "لا يجوز إنشاء الحسابات بشكل مجمّع لتجاوز حدود الرصيد أو الاستخدام.",
          "أنت مسؤول عن النشاط الذي يتم من خلال حسابك.",
          "قد يتم تقييد الحسابات أو تعليقها أو مراجعتها يدويًا إذا تم اكتشاف إساءة استخدام أو احتيال أو مشاركة للحساب.",
        ],
      },
      {
        title: "حدود الاستخدام",
        summary: "سقوف الخدمة الحالية المستخدمة للتحكم في التكلفة والتعرض للإساءة.",
        items: [
          "أول 24 ساعة بعد التسجيل: إجمالي استخدام بحد أقصى رصيد واحد (1).",
          "بعد الـ 24 ساعة الأولى: بحد أقصى 5 أرصدة لكل 24 ساعة متتالية.",
          "يتم احتساب رسوم التحليل الذكي ورسوم الإنشاء والاستخدام المفوتر للدردشة النصية البسيطة ضمن استخدام الحساب.",
          "قد تحظر ضوابط الأمان أو الرصيد أو الإساءة أو حدود المزود من جانب المشغل الطلبات قبل تشغيل الإجراء المطلوب.",
        ],
      },
      {
        title: "قواعد الأرصدة، الفوترة والاسترداد",
        summary: "كيف يتم استهلاك الأرصدة ومتى يجب أو لا يجب أن يتم احتساب رسوم.",
        items: [
          "يفرض Vibecraft رسومًا على الأرصدة بناءً على منطق الفوترة النشط لسير العمل أو النموذج المحدد.",
          "إذا لم يتمكن Vibecraft من تقديم نتيجة قابلة للاستخدام، فلا ينبغي فرض رسوم على المستخدم مقابل هذه النتيجة الفاشلة ما لم ينص على خلاف ذلك داخل المنتج.",
          "إذا نجح الطلب وتم تكبد تكلفة المزود بالفعل، فقد تظل النتيجة المسلمة مشحونة حتى إذا أصبح الرصيد النهائي للحساب سالبًا بشكل طفيف.",
          "لا تنتهي صلاحية أرصدة Vibecraft القياسية ما لم ينص رصيد ترويجي محدد صراحة على خلاف ذلك.",
          "الأرصدة غير قابلة للتحويل ولا يُقصد تداولها أو إعادة بيعها أو تجميعها عبر الحسابات.",
        ],
      },
      {
        title: "قواعد رموز الرصيد",
        summary: "قواعد الاسترداد، وحدود مكافحة التخمين المتكرر، وعواقب المحاولات الفاشلة المتكررة.",
        items: [
          "لا يجوز لأي حساب استرداد أكثر من 4 رموز رصيد في يوم واحد.",
          "لا يجوز لأي حساب استرداد أكثر من 10 رموز رصيد في 7 أيام.",
          "إذا وصل الحساب إلى 5 محاولات فاشلة لرمز الرصيد في 5 دقائق، يتم حظر الاسترداد لمدة 5 دقائق.",
          "10 محاولات فاشلة متتالية يمكن أن تؤدي إلى تعليق لمدة ساعة واحدة.",
          "20 محاولة فاشلة متتالية لرمز الرصيد خلال 24 ساعة يمكن أن تؤدي إلى تعليق حتى المراجعة الإدارية.",
          "لا يجوز إساءة استخدام رموز الرصيد من خلال التجميع الاحتيالي للحسابات أو محاولات التخمين المتكررة.",
        ],
      },
      {
        title: "الاستخدام المقبول والمحتوى المحظور",
        summary: "المحتوى الأساسي وقواعد إساءة استخدام المنصة التي تنطبق على جميع مسارات العمل.",
        items: [
          "لا يُسمح بالمحتوى الجنسي أو الإباحي الصريح.",
          "لا يُسمح بالمحتوى الاستغلالي أو المسيء أو البغيض أو الاحتيالي أو غير القانوني.",
          "لا توجد محاولات لإساءة استخدام المنصة أو تجاوز الإشراف أو مهاجمة المزودين.",
          "لا تقم بتحميل محتوى ليس لديك الحق في استخدامه أو معالجته أو تحويله أو الإنشاء منه.",
          "لا تستخدم Vibecraft للبريد العشوائي أو هجمات اختراق الحسابات أو استكشاف المزودين أو استخلاص البيانات أو الإساءة الآلية.",
        ],
      },
      {
        title: "الإنفاذ والتعليق",
        summary: "ماذا يمكن أن يحدث إذا تم انتهاك هذه القواعد.",
        items: [
          "قد يشمل الإنفاذ التحذيرات أو القيود المؤقتة أو حظر رمز الرصيد أو حظر الإنشاء أو التعليق أو الإزالة الدائمة.",
          "قد يؤدي الاحتيال الخطير أو سلوك التخمين المتكرر أو إنشاء حسابات وهمية متعددة أو إساءة استخدام المزودين إلى التعليق الفوري دون سابق إنذار.",
          "يجوز للمشغل مراجعة السجلات وسجلات الفواتير وسجل الإنشاء وإشارات الإساءة عند التحقيق في الانتهاكات.",
        ],
      },
      {
        title: "إخلاء المسؤولية عن المخرجات والطعون",
        summary: "ما لا يضمنه Vibecraft وكيف يجب تصعيد النزاعات.",
        items: [
          "قد تكون المخرجات المنشأة غير دقيقة أو غير كاملة أو متحيزة أو غير مناسبة للقرارات القانونية أو الطبية أو المالية أو غيرها من القرارات ذات المخاطر العالية.",
          "أنت مسؤول عن مراجعة المخرجات والتحقق من صحتها قبل نشرها أو بيعها أو الاعتماد عليها.",
          "إذا كنت تعتقد أن إجراء الإنفاذ أو نتيجة الفوترة غير صحيحة، فاتصل بدعم Vibecraft على ouni@novanode.tn.",
        ],
      },
    ],
  },
};

function PolicyContent() {
  const { language, setLanguage } = useLanguage();
  
  // Type assertion to ensure language falls back gracefully
  const currentLang = (language && policyLocales[language as keyof typeof policyLocales]) ? language as keyof typeof policyLocales : 'en';
  const content = policyLocales[currentLang];

  return (
    <main className="relative min-h-screen bg-[#070d19] px-4 py-10 sm:px-6 lg:px-8 lg:py-14" dir={currentLang === 'ar' ? 'rtl' : 'ltr'}>
      <Link href="/" className="absolute top-6 left-6 z-50 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-[#081121]/80 text-slate-400 backdrop-blur-md transition-all hover:border-blue-500/30 hover:bg-blue-500/10 hover:text-white hover:shadow-[0_0_15px_rgba(59,130,246,0.2)] rtl:left-auto rtl:right-6">
        <span className="material-symbols-outlined text-[18px]">home</span>
      </Link>
      <div className="absolute top-6 right-6 z-50 flex items-center rounded-full border border-white/10 bg-[#081121]/80 p-1 backdrop-blur-md rtl:right-auto rtl:left-6" dir="ltr">
        {(
          [
            { id: "en", label: "EN" },
            { id: "fr", label: "FR" },
            { id: "ar", label: "AR" },
          ] as const
        ).map((lang) => (
          <button
            key={lang.id}
            onClick={() => setLanguage(lang.id)}
            className={`relative px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${
              currentLang === lang.id
                ? "text-white"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {currentLang === lang.id && (
              <span className="absolute inset-0 rounded-full bg-blue-500/20 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.2)]" />
            )}
            <span className="relative z-10">{lang.label}</span>
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-6xl space-y-8 mt-8">
        <section className="overflow-hidden rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(59,130,246,0.2),transparent_30%),radial-gradient(circle_at_right,rgba(139,92,246,0.18),transparent_28%),#081121] p-6 shadow-[0_35px_100px_rgba(0,0,0,0.42)] sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">{content.header.label}</div>
              <h1 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {content.header.title}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                {content.header.desc}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl border border-blue-500/20 bg-blue-500/[0.08] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-blue-200/70">{content.effective.label}</div>
                <div className="mt-2 text-xl font-bold text-white">{content.effective.date}</div>
                <p className="mt-3 text-sm leading-7 text-slate-300">
                  {content.effective.desc}
                </p>
              </div>
              <div className="rounded-xl border border-white/8 bg-white/[0.03] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{content.support.label}</div>
                <div className="mt-2 text-xl font-bold text-white">{content.support.email}</div>
                <p className="mt-3 text-sm leading-7 text-slate-400">
                  {content.support.desc}
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          {content.sections.map((section) => (
            <article
              key={section.title}
              className="rounded-2xl border border-white/8 bg-[#081121] p-6 shadow-[0_24px_70px_rgba(0,0,0,0.25)] sm:p-7"
            >
              <div className="text-xs uppercase tracking-[0.22em] text-slate-500">{section.title}</div>
              <p className="mt-3 text-sm leading-7 text-slate-400">{section.summary}</p>
              <ul className="mt-6 space-y-3 text-sm leading-7 text-slate-200">
                {section.items.map((item, i) => (
                  <li key={i} className={`border-white/10 ${currentLang === 'ar' ? 'border-r pr-4' : 'border-l pl-4'}`}>
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </section>

        <section>
          <div className="rounded-2xl border border-white/8 bg-[#081121] p-6 sm:p-8">
            <div className="text-xs uppercase tracking-[0.24em] text-slate-500">{content.footer.label}</div>
            <h2 className="mt-3 text-2xl font-bold text-white">{content.footer.title}</h2>
            <p className="mt-4 max-w-2xl text-sm leading-8 text-slate-400">
              {content.footer.desc}
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function PolicyPage() {
  return (
    <LanguageProvider>
      <PolicyContent />
    </LanguageProvider>
  );
}
