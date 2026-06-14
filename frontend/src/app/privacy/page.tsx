"use client";

import Link from "next/link";
import { useLanguage } from "@/context/LanguageContext";

const privacyLocales = {
  en: {
    header: {
      label: "Privacy Policy",
      title: "How Vibecraft collects, uses, shares, stores, and protects service data.",
      desc: "This page explains the current operating privacy rules for accounts, prompts, uploads, generated content, billing records, and security logging. It is separate from the Usage Policy, which defines platform behavior rules, enforcement, credits, and suspensions.",
      note: "User data is treated as private by default. Access to stored account data is intended to be limited to the authenticated account owner, except where limited operator or processor access is required to run, secure, support, or comply with legal obligations of the service."
    },
    effective: {
      label: "Effective",
      date: "April 24, 2026",
      desc: "This privacy policy applies to all current Vibecraft operations unless replaced by a later revision."
    },
    support: {
      label: "Contact",
      email: "ouni@novanode.tn",
      desc: "Privacy questions, deletion requests, and data inquiries should be sent to the current Vibecraft support contact."
    },
    sections: [
      {
        title: "Operator And Scope",
        summary: "Who runs Vibecraft and what this page covers.",
        items: [
          "Vibecraft is currently operated as a managed online AI studio service under active operator control.",
          "This Privacy Policy applies to Vibecraft accounts, prompts, uploads, generated outputs, billing records, support interactions, and security logs.",
          "Effective date: April 24, 2026. This page may be updated as the service, infrastructure, or provider stack changes."
        ]
      },
      {
        title: "Data We Collect",
        summary: "The categories of data required to operate the product.",
        items: [
          "Account and identity data such as email address, display name, and sign-in provider information.",
          "Product data such as prompts, chat turns, uploaded images, generated images, generated text, model selections, and parameter choices.",
          "Billing and service records such as credit ledger entries, usage totals, redemption activity, request status, and failure logs.",
          "Security and abuse-prevention data such as login events, IP-related abuse signals, rate-limit events, and operator audit logs."
        ]
      },
      {
        title: "How We Use Data",
        summary: "Why this information is processed.",
        items: [
          "To authenticate users, maintain accounts, and keep sessions secure.",
          "To deliver chat responses, image generation, smart generation workflows, and related creative features.",
          "To calculate usage, enforce credit balances, apply billing rules, and prevent fraud or abuse.",
          "To investigate failures, improve reliability, monitor provider behavior, and protect the platform and provider accounts."
        ]
      },
      {
        title: "Providers And Processors",
        summary: "Where data may be processed outside the core app.",
        items: [
          "Vibecraft may use third-party identity, hosting, storage, database, logging, and AI model providers to operate the service.",
          "Prompts, images, and generation instructions may be transmitted to external AI providers when needed to deliver requested outputs.",
          "We do not sell personal data. We may disclose limited information where required for security, fraud prevention, legal compliance, or protection of service infrastructure."
        ]
      },
      {
        title: "Retention",
        summary: "How long records may remain in service systems.",
        items: [
          "Account, billing, redemption, and abuse-prevention records may be retained as long as reasonably necessary for service operation, fraud prevention, and audit purposes.",
          "Prompts, chat history, uploaded assets, and generated outputs may be retained until deleted by the user, removed by the operator, or cleared by product retention rules.",
          "System backups, logs, and provider-facing request traces may remain for a limited period after deletion from the main product interface."
        ]
      },
      {
        title: "User Requests And Rights",
        summary: "What users may ask us to do with their data.",
        items: [
          "You may request account closure, deletion review, or correction of obvious account information errors through the current Vibecraft support channel.",
          "You may also delete your own stored playground conversations directly from the product interface when that control is available.",
          "Some records may be retained when reasonably required for billing integrity, fraud prevention, abuse investigations, legal obligations, or security review.",
          "Deletion requests may not remove data already processed by third-party providers under their own service operations and retention controls."
        ]
      },
      {
        title: "Security, Age Limit, And Contact",
        summary: "Baseline user-safety and access assumptions.",
        items: [
          "We use authentication, session controls, rate limits, access controls, and logging, but no system can guarantee absolute security.",
          "Do not submit highly sensitive personal, financial, medical, or confidential regulated information into Vibecraft.",
          "Vibecraft is not intended for children. You must be at least 13 years old, or older if required by your local law, to use the service.",
          "For privacy questions, deletion requests, or policy concerns, contact Vibecraft Support at ouni@novanode.tn."
        ]
      }
    ]
  },
  fr: {
    header: {
      label: "Politique de Confidentialité",
      title: "Comment Vibecraft collecte, utilise, partage, stocke et protège les données du service.",
      desc: "Cette page explique les règles de confidentialité actuelles concernant les comptes, les prompts, les fichiers téléversés, le contenu généré, les registres de facturation et la journalisation de la sécurité. Elle est distincte de la politique d'utilisation, qui définit les règles de comportement de la plateforme, l'application, les crédits et les suspensions.",
      note: "Les données des utilisateurs sont considérées comme privées par défaut. L'accès aux données de compte stockées est censé être limité au propriétaire de compte authentifié, sauf lorsqu'un accès limité de l'opérateur ou du processeur est requis pour exécuter, sécuriser, prendre en charge ou se conformer aux obligations légales du service."
    },
    effective: {
      label: "Date d'effet",
      date: "24 Avril 2026",
      desc: "Cette politique de confidentialité s'applique à toutes les opérations actuelles de Vibecraft à moins d'être remplacée par une révision ultérieure."
    },
    support: {
      label: "Contact",
      email: "ouni@novanode.tn",
      desc: "Les questions de confidentialité, les demandes de suppression et les demandes de données doivent être envoyées au contact d'assistance actuel de Vibecraft."
    },
    sections: [
      {
        title: "Opérateur et Portée",
        summary: "Qui dirige Vibecraft et ce que couvre cette page.",
        items: [
          "Vibecraft est actuellement exploité comme un service de studio d'IA géré en ligne sous le contrôle actif de l'opérateur.",
          "Cette politique de confidentialité s'applique aux comptes Vibecraft, aux prompts, aux fichiers téléversés, aux sorties générées, aux registres de facturation, aux interactions d'assistance et aux journaux de sécurité.",
          "Date d'effet : 24 avril 2026. Cette page peut être mise à jour à mesure que le service, l'infrastructure ou la pile de fournisseurs changent."
        ]
      },
      {
        title: "Données que nous collectons",
        summary: "Les catégories de données nécessaires pour faire fonctionner le produit.",
        items: [
          "Données de compte et d'identité telles que l'adresse e-mail, le nom d'affichage et les informations sur le fournisseur de connexion.",
          "Données de produit telles que les prompts, l'historique des échanges, les images téléchargées, les images générées, le texte généré, les sélections de modèles et les choix de paramètres.",
          "Registres de facturation et de service tels que les entrées de grand livre de crédit, les totaux d'utilisation, l'activité de réclamation, l'état des requêtes et les journaux de défaillance.",
          "Données de sécurité et de prévention des abus telles que les événements de connexion, les signaux d'abus liés à l'IP, les événements de limite de débit et les journaux d'audit de l'opérateur."
        ]
      },
      {
        title: "Comment nous utilisons les données",
        summary: "Pourquoi ces informations sont traitées.",
        items: [
          "Pour authentifier les utilisateurs, maintenir les comptes et sécuriser les sessions.",
          "Pour fournir des réponses de chat, la génération d'images, des flux de travail de génération intelligente et des fonctionnalités créatives associées.",
          "Pour calculer l'utilisation, appliquer les soldes de crédit, appliquer les règles de facturation et prévenir la fraude ou les abus.",
          "Pour enquêter sur les défaillances, améliorer la fiabilité, surveiller le comportement des fournisseurs et protéger la plateforme et les comptes des fournisseurs."
        ]
      },
      {
        title: "Fournisseurs et Sous-traitants",
        summary: "Où les données peuvent être traitées en dehors de l'application principale.",
        items: [
          "Vibecraft peut utiliser des fournisseurs tiers d'identité, d'hébergement, de stockage, de base de données, de journalisation et de modèles d'IA pour exploiter le service.",
          "Les prompts, les images et les instructions de génération peuvent être transmises à des fournisseurs d'IA externes lorsque cela est nécessaire pour fournir les résultats demandés.",
          "Nous ne vendons pas de données personnelles. Nous pouvons divulguer des informations limitées lorsque cela est nécessaire pour la sécurité, la prévention de la fraude, la conformité légale ou la protection de l'infrastructure de service."
        ]
      },
      {
        title: "Conservation",
        summary: "Combien de temps les dossiers peuvent rester dans les systèmes de service.",
        items: [
          "Les dossiers de compte, de facturation, de réclamation et de prévention des abus peuvent être conservés aussi longtemps que raisonnablement nécessaire pour le fonctionnement du service, la prévention de la fraude et à des fins d'audit.",
          "Les prompts, l'historique des discussions, les ressources téléchargées et les résultats générés peuvent être conservés jusqu'à ce qu'ils soient supprimés par l'utilisateur, supprimés par l'opérateur ou effacés par les règles de conservation des produits.",
          "Les sauvegardes du système, les journaux et les traces de demandes adressées au fournisseur peuvent subsister pendant une période limitée après suppression de l'interface principale du produit."
        ]
      },
      {
        title: "Demandes et Droits des Utilisateurs",
        summary: "Ce que les utilisateurs peuvent nous demander de faire avec leurs données.",
        items: [
          "Vous pouvez demander la fermeture de votre compte, un examen de suppression ou la correction d'erreurs évidentes dans les informations de compte via le canal de support Vibecraft actuel.",
          "Vous pouvez également supprimer vos propres conversations de l'espace Playground stockées directement depuis l'interface du produit lorsque ce contrôle est disponible.",
          "Certains dossiers peuvent être conservés lorsque cela est raisonnablement nécessaire pour l'intégrité de la facturation, la prévention de la fraude, les enquêtes sur les abus, les obligations légales ou l'examen de la sécurité.",
          "Les demandes de suppression peuvent ne pas supprimer les données déjà traitées par des fournisseurs tiers en vertu de leurs propres opérations de service et de leurs contrôles de conservation."
        ]
      },
      {
        title: "Sécurité, Limite d'Âge et Contact",
        summary: "Les hypothèses de base en matière de sécurité et d'accès des utilisateurs.",
        items: [
          "Nous utilisons l'authentification, les contrôles de session, les limites de débit, les contrôles d'accès et la journalisation, mais aucun système ne peut garantir une sécurité absolue.",
          "Ne soumettez pas d'informations personnelles, financières, médicales ou confidentielles réglementées très sensibles dans Vibecraft.",
          "Vibecraft n'est pas destiné aux enfants. Vous devez avoir au moins 13 ans, ou plus si la loi locale l'exige, pour utiliser le service.",
          "Pour des questions de confidentialité, des demandes de suppression ou des préoccupations en matière de politique, contactez le support de Vibecraft à ouni@novanode.tn."
        ]
      }
    ]
  },
  ar: {
    header: {
      label: "سياسة الخصوصية",
      title: "كيف يقوم Vibecraft بجمع بيانات الخدمة واستخدامها ومشاركتها وتخزينها وحمايتها.",
      desc: "تشرح هذه الصفحة قواعد الخصوصية التشغيلية الحالية للحسابات، والأوامر (Prompts)، والتحميلات، والمحتوى الذي تم إنشاؤه، وسجلات الفواتير، وسجلات الأمان. وهي منفصلة عن سياسة الاستخدام التي تحدد قواعد سلوك النظام الأساسي والتنفيذ والأرصدة والتعليق.",
      note: "يتم التعامل مع بيانات المستخدم على أنها خاصة افتراضيًا. يقتصر الوصول إلى بيانات الحساب المخزنة على مالك الحساب المصادق عليه، إلا في الحالات التي يتطلب فيها وصول المشغل أو المعالج المحدود لتشغيل الخدمة أو تأمينها أو دعمها أو الامتثال للالتزامات القانونية."
    },
    effective: {
      label: "تاريخ السريان",
      date: "24 أبريل 2026",
      desc: "تنطبق سياسة الخصوصية هذه على جميع عمليات Vibecraft الحالية ما لم يتم استبدالها بمراجعة لاحقة."
    },
    support: {
      label: "اتصل بنا",
      email: "ouni@novanode.tn",
      desc: "يجب إرسال أسئلة الخصوصية وطلبات الحذف واستفسارات البيانات إلى جهة اتصال دعم Vibecraft الحالية."
    },
    sections: [
      {
        title: "المشغل والنطاق",
        summary: "من يدير Vibecraft وما تغطيه هذه الصفحة.",
        items: [
          "يتم تشغيل Vibecraft حاليًا كخدمة استوديو ذكاء اصطناعي مُدارة عبر الإنترنت تحت سيطرة المشغل النشطة.",
          "تنطبق سياسة الخصوصية هذه على حسابات Vibecraft والأوامر (Prompts) والتحميلات والمخرجات التي تم إنشاؤها وسجلات الفواتير وتفاعلات الدعم وسجلات الأمان.",
          "تاريخ السريان: 24 أبريل 2026. قد يتم تحديث هذه الصفحة مع تغير الخدمة أو البنية التحتية أو مجموعة المزودين."
        ]
      },
      {
        title: "البيانات التي نجمعها",
        summary: "فئات البيانات المطلوبة لتشغيل المنتج.",
        items: [
          "بيانات الحساب والهوية مثل عنوان البريد الإلكتروني واسم العرض ومعلومات مزود تسجيل الدخول.",
          "بيانات المنتج مثل الأوامر (Prompts) وسياق المحادثات والصور المحملة والصور المنشأة والنصوص المنشأة واختيارات النماذج واختيارات المعلمات.",
          "سجلات الفوترة والخدمة مثل إدخالات دفتر الأستاذ الائتماني وإجماليات الاستخدام ونشاط الاسترداد وحالة الطلب وسجلات الفشل.",
          "بيانات الأمان ومنع الإساءة مثل أحداث تسجيل الدخول وإشارات الإساءة المتعلقة بـ IP وأحداث قيود معدل الطلبات (Rate-limiting) وسجلات تدقيق المشغل."
        ]
      },
      {
        title: "كيف نستخدم البيانات",
        summary: "لماذا تتم معالجة هذه المعلومات.",
        items: [
          "لمصادقة المستخدمين والحفاظ على الحسابات وإبقاء الجلسات آمنة.",
          "لتقديم استجابات الدردشة وإنشاء الصور وسير عمل الإنشاء الذكي والميزات الإبداعية ذات الصلة.",
          "لحساب الاستخدام وإنفاذ أرصدة الائتمان وتطبيق قواعد الفوترة ومنع الاحتيال أو إساءة الاستخدام.",
          "للتحقيق في حالات الفشل وتحسين الموثوقية ومراقبة سلوك المزود وحماية النظام الأساسي وحسابات المزودين."
        ]
      },
      {
        title: "المزودون والمعالجون",
        summary: "حيث يمكن معالجة البيانات خارج التطبيق الأساسي.",
        items: [
          "قد تستخدم Vibecraft موفري هوية واستضافة وتخزين وقواعد بيانات وتسجيل ونماذج ذكاء اصطناعي تابعين لجهات خارجية لتشغيل الخدمة.",
          "قد يتم نقل الأوامر (Prompts) والصور وتعليمات الإنشاء إلى موفري الذكاء الاصطناعي الخارجيين عند الحاجة لتقديم المخرجات المطلوبة.",
          "نحن لا نبيع البيانات الشخصية. قد نكشف عن معلومات محدودة عند الاقتضاء للأمن أو منع الاحتيال أو الامتثال القانوني أو حماية البنية التحتية للخدمة."
        ]
      },
      {
        title: "الاحتفاظ بالبيانات",
        summary: "إلى متى قد تبقى السجلات في أنظمة الخدمة.",
        items: [
          "قد يتم الاحتفاظ بسجلات الحسابات والفوترة والاسترداد ومنع إساءة الاستخدام طالما كان ذلك ضروريًا بشكل معقول لتشغيل الخدمة ومنع الاحتيال وأغراض التدقيق.",
          "قد يتم الاحتفاظ بالأوامر (Prompts) وسجل الدردشة والأصول المحملة والمخرجات التي تم إنشاؤها حتى يحذفها المستخدم أو يزيلها المشغل أو تمسحها قواعد الاحتفاظ بالمنتج.",
          "قد تظل النسخ الاحتياطية للنظام والسجلات وتتبعات الطلبات التي تواجه المزود لفترة محدودة بعد حذفها من واجهة المنتج الرئيسية."
        ]
      },
      {
        title: "طلبات المستخدمين وحقوقهم",
        summary: "ما يمكن للمستخدمين أن يطلبوا منا فعله ببياناتهم.",
        items: [
          "يمكنك طلب إغلاق الحساب أو مراجعة الحذف أو تصحيح أخطاء معلومات الحساب الواضحة من خلال قناة دعم Vibecraft الحالية.",
          "يمكنك أيضًا حذف محادثات مساحة التجربة (Playground) المخزنة مباشرة من واجهة المنتج عند توفر عنصر التحكم هذا.",
          "قد يتم الاحتفاظ ببعض السجلات عندما يكون ذلك مطلوبًا بشكل معقول لسلامة الفوترة أو منع الاحتيال أو التحقيقات في إساءة الاستخدام أو الالتزامات القانونية أو المراجعة الأمنية.",
          "قد لا تزيل طلبات الحذف البيانات التي تمت معالجتها بالفعل بواسطة جهات خارجية ضمن عمليات الخدمة وضوابط الاستبقاء الخاصة بها."
        ]
      },
      {
        title: "الأمان، الحد الأدنى للعمر، والاتصال",
        summary: "الافتراضات الأساسية لسلامة المستخدم والوصول.",
        items: [
          "نحن نستخدم المصادقة وضوابط الجلسة وقيود معدل الطلبات وضوابط الوصول والتسجيل، ولكن لا يمكن لأي نظام أن يضمن الأمان المطلق.",
          "لا ترسل معلومات منظمة شخصية أو مالية أو طبية أو سرية حساسة للغاية إلى Vibecraft.",
          "Vibecraft غير مخصص للأطفال. يجب أن يكون عمرك 13 عامًا على الأقل، أو أكبر إذا كان القانون المحلي الخاص بك يتطلب ذلك، لاستخدام الخدمة.",
          "للأسئلة المتعلقة بالخصوصية أو طلبات الحذف أو مخاوف السياسة، اتصل بدعم Vibecraft على ouni@novanode.tn."
        ]
      }
    ]
  }
};

function PrivacyContent() {
  const { language, setLanguage } = useLanguage();
  
  // Type assertion to ensure language falls back gracefully
  const currentLang = (language && privacyLocales[language as keyof typeof privacyLocales]) ? language as keyof typeof privacyLocales : 'en';
  const content = privacyLocales[currentLang];

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
        <section className="overflow-hidden rounded-2xl border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.16),transparent_32%),radial-gradient(circle_at_right,rgba(59,130,246,0.15),transparent_28%),#081121] p-6 shadow-[0_35px_100px_rgba(0,0,0,0.42)] sm:p-8 lg:p-10">
          <div className="grid gap-8 xl:grid-cols-[1.15fr_0.85fr]">
            <div>
              <div className="text-xs uppercase tracking-[0.28em] text-slate-500">{content.header.label}</div>
              <h1 className="mt-4 max-w-3xl text-2xl font-bold tracking-tight text-white sm:text-3xl">
                {content.header.title}
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                {content.header.desc}
              </p>
              <div className="mt-6 max-w-2xl rounded-xl border border-emerald-400/20 bg-emerald-400/[0.08] px-4 py-4 text-sm leading-7 text-emerald-50">
                {content.header.note}
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.07] p-5">
                <div className="text-xs uppercase tracking-[0.22em] text-emerald-200/70">{content.effective.label}</div>
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

      </div>
    </main>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent />;
}
