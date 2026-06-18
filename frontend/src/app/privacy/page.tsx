"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

const chrome = {
  en: { home: "Home", policy: "Policy", privacy: "Privacy", toc: "On This Page", rights: "All rights reserved.", support: "Support" },
  fr: { home: "Accueil", policy: "Politique", privacy: "Confidentialité", toc: "Sur cette page", rights: "Tous droits réservés.", support: "Support" },
  ar: { home: "الرئيسية", policy: "السياسة", privacy: "الخصوصية", toc: "في هذه الصفحة", rights: "جميع الحقوق محفوظة.", support: "الدعم" },
} as const;

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
      date: "June 18, 2026",
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
          "Effective date: June 18, 2026. This page may be updated as the service, infrastructure, or provider stack changes."
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
          "We use cookies and similar technologies, together with third-party analytics and measurement tools, to understand how the service is used and to improve and promote it; these tools may set cookies and receive aggregate usage and device information.",
          "We do not sell personal data. We may disclose limited information where required for security, fraud prevention, legal compliance, or protection of service infrastructure."
        ]
      },
      {
        title: "Content Moderation And Third-Party Processing",
        summary: "Third-party services used to screen requests for safety before processing.",
        items: [
          "Before a request is processed, its prompt text and any uploaded images are sent to third-party content-moderation services — such as OpenAI and Google — solely to screen for policy-violating content.",
          "This screening is transient and used only for safety: the moderated content is checked in real time and that content is not used to build advertising or marketing profiles.",
          "We log moderation outcomes and category scores (not necessarily the full content) for safety, abuse prevention, and enforcement of our Acceptable Use rules.",
          "Under those providers' API terms, data sent for moderation is not used to train their models.",
          "The legal basis for this processing is our legitimate interest in keeping the platform safe and enforcing our Terms of Use.",
        ],
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
      date: "18 Juin 2026",
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
          "Date d'effet : 18 juin 2026. Cette page peut être mise à jour à mesure que le service, l'infrastructure ou la pile de fournisseurs changent."
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
          "Nous utilisons des cookies et des technologies similaires, ainsi que des outils d'analyse et de mesure tiers, pour comprendre comment le service est utilisé et pour l'améliorer et le promouvoir ; ces outils peuvent déposer des cookies et recevoir des données d'utilisation et d'appareil agrégées.",
          "Nous ne vendons pas de données personnelles. Nous pouvons divulguer des informations limitées lorsque cela est nécessaire pour la sécurité, la prévention de la fraude, la conformité légale ou la protection de l'infrastructure de service."
        ]
      },
      {
        title: "Modération de Contenu et Traitement par des Tiers",
        summary: "Services tiers utilisés pour analyser les requêtes à des fins de sécurité avant traitement.",
        items: [
          "Avant qu'une requête ne soit traitée, le texte de l'invite et toute image téléchargée sont envoyés à des services de modération de contenu tiers — tels que OpenAI et Google — uniquement pour détecter tout contenu interdit.",
          "Cette analyse est transitoire et utilisée uniquement à des fins de sécurité : le contenu modéré est vérifié en temps réel et ce contenu n'est pas utilisé pour créer des profils publicitaires ou marketing.",
          "Nous enregistrons les résultats de la modération et les scores par catégorie (pas nécessairement le contenu complet) à des fins de sécurité, de prévention des abus et d'application de nos règles d'utilisation acceptable.",
          "Conformément aux conditions des API de ces fournisseurs, les données envoyées pour modération ne sont pas utilisées pour entraîner leurs modèles.",
          "La base légale de ce traitement est notre intérêt légitime à maintenir la sécurité de la plateforme et à faire respecter nos Conditions d'utilisation.",
        ],
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
      date: "18 يونيو 2026",
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
          "تاريخ السريان: 18 يونيو 2026. قد يتم تحديث هذه الصفحة مع تغير الخدمة أو البنية التحتية أو مجموعة المزودين."
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
          "نستخدم ملفات تعريف الارتباط (الكوكيز) وتقنيات مشابهة، إلى جانب أدوات تحليلات وقياس تابعة لجهات خارجية، لفهم كيفية استخدام الخدمة وتحسينها والترويج لها؛ وقد تضع هذه الأدوات ملفات تعريف ارتباط وتتلقى بيانات استخدام وجهاز مجمّعة.",
          "نحن لا نبيع البيانات الشخصية. قد نكشف عن معلومات محدودة عند الاقتضاء للأمن أو منع الاحتيال أو الامتثال القانوني أو حماية البنية التحتية للخدمة."
        ]
      },
      {
        title: "الإشراف على المحتوى والمعالجة عبر أطراف ثالثة",
        summary: "خدمات تابعة لأطراف ثالثة تُستخدم لفحص الطلبات لأغراض الأمان قبل معالجتها.",
        items: [
          "قبل معالجة الطلب، يتم إرسال نص الموجّه وأي صور تم تحميلها إلى خدمات إشراف على المحتوى تابعة لأطراف ثالثة — مثل OpenAI وGoogle — لغرض وحيد هو فحص المحتوى المخالف للسياسة.",
          "هذا الفحص مؤقت ويُستخدم لأغراض الأمان فقط: يتم فحص المحتوى الخاضع للإشراف في الوقت الفعلي ولا يُستخدم هذا المحتوى لبناء ملفات تعريف إعلانية أو تسويقية.",
          "نسجّل نتائج الإشراف ودرجات الفئات (وليس بالضرورة المحتوى الكامل) لأغراض الأمان ومنع الإساءة وتطبيق قواعد الاستخدام المقبول لدينا.",
          "بموجب شروط واجهات برمجة التطبيقات لهؤلاء المزودين، لا تُستخدم البيانات المُرسلة للإشراف لتدريب نماذجهم.",
          "الأساس القانوني لهذه المعالجة هو مصلحتنا المشروعة في الحفاظ على أمان المنصة وإنفاذ شروط الاستخدام.",
        ],
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
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState("");

  // Language fallback
  const currentLang = (language && privacyLocales[language as keyof typeof privacyLocales]) ? language as keyof typeof privacyLocales : 'en';
  const content = privacyLocales[currentLang];
  const ui = chrome[currentLang];
  const isRtl = currentLang === 'ar';

  // Scroll spy for the table of contents + sticky-header shadow
  useEffect(() => {
    const handler = () => {
      setScrolled(window.scrollY > 20);
      const secs = Array.from(document.querySelectorAll<HTMLElement>('section[data-spy]'));
      let current = "";
      for (const s of secs) {
        if (window.scrollY >= s.offsetTop - 150) current = s.id;
      }
      setActiveId(current);
    };
    handler();
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, [currentLang]);

  return (
    <div className="vc-privacy min-h-screen bg-[#0b1326] text-[#dae2fd] selection:bg-[#57f1db]/30" dir={isRtl ? 'rtl' : 'ltr'}>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .vc-privacy { font-family: 'Inter', system-ui, sans-serif; scroll-behavior: smooth; }
        .vc-display { font-family: 'Hanken Grotesk', system-ui, sans-serif; }
        .vc-mono { font-family: 'JetBrains Mono', monospace; }
        .vc-prose h2 { font-family: 'Hanken Grotesk', sans-serif; font-size: 1.5rem; font-weight: 600; margin-top: 2.5rem; margin-bottom: 1rem; color: #57f1db; scroll-margin-top: 120px; }
        .vc-prose section:first-child h2 { margin-top: 0; }
        .vc-prose p { font-family: 'Inter', sans-serif; font-size: 1rem; line-height: 1.75; margin-bottom: 1.25rem; color: #bacac5; }
        .vc-prose ul { list-style: none; padding-left: 0; margin-bottom: 1.5rem; }
        .vc-prose li { position: relative; padding-left: 1.5rem; margin-bottom: 0.75rem; color: #bacac5; line-height: 1.7; }
        .vc-prose li::before { content: ""; position: absolute; left: 0; top: 0.62em; width: 6px; height: 6px; background-color: #57f1db; border-radius: 1px; }
        [dir="rtl"] .vc-prose li { padding-left: 0; padding-right: 1.5rem; }
        [dir="rtl"] .vc-prose li::before { left: auto; right: 0; }
        .vc-glass { background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.06); }
        .vc-tocnav { border-left: 1px solid rgba(60, 74, 70, 0.35); }
        [dir="rtl"] .vc-tocnav { border-left: none; border-right: 1px solid rgba(60, 74, 70, 0.35); }
        .vc-toc-link { display: block; padding-left: 1rem; border-left: 2px solid transparent; transition: color .2s, border-color .2s; color: #9fb0ab; }
        .vc-toc-link:hover { color: #57f1db; }
        .vc-toc-link.active { color: #57f1db; border-left-color: #57f1db; font-weight: 600; }
        [dir="rtl"] .vc-toc-link { padding-left: 0; padding-right: 1rem; border-left: none; border-right: 2px solid transparent; }
        [dir="rtl"] .vc-toc-link.active { border-right-color: #57f1db; }
      ` }} />

      {/* Top navigation */}
      <header className={`fixed top-0 inset-x-0 z-50 h-20 border-b backdrop-blur-md transition-all duration-300 ${scrolled ? 'bg-[#0b1326]/95 shadow-lg border-[#3c4a46]/40' : 'bg-[#0b1326]/80 border-[#3c4a46]/20'}`}>
        <div className="flex h-full items-center justify-between max-w-[1280px] mx-auto px-5 lg:px-12">
          <div className="flex items-center gap-8">
            <Link href="/" className="vc-display text-2xl font-bold text-[#57f1db] tracking-tight">Vibecraft</Link>
            <nav className="hidden md:flex gap-6">
              <Link href="/" className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.home}</Link>
              <Link href="/policy" className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.policy}</Link>
              <span className="text-[15px] text-[#57f1db] font-semibold border-b-2 border-[#57f1db] pb-1">{ui.privacy}</span>
            </nav>
          </div>
          <div className="flex items-center rounded-full border border-white/10 bg-[#060e20]/80 p-1" dir="ltr">
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
                className={`relative px-4 py-1.5 text-xs font-bold uppercase tracking-wider transition-all duration-300 ${currentLang === lang.id ? 'text-[#0b1326]' : 'text-[#bacac5] hover:text-[#dae2fd]'}`}
              >
                {currentLang === lang.id && <span className="absolute inset-0 rounded-full bg-[#57f1db]" />}
                <span className="relative z-10">{lang.label}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="pt-32 pb-24 max-w-[1280px] mx-auto px-5 lg:px-12">
        {/* Hero */}
        <header className="mb-16">
          <div className="vc-mono text-[12px] uppercase tracking-[0.2em] text-[#57f1db] mb-3">{content.header.label}</div>
          <h1 className="vc-display text-3xl sm:text-[44px] sm:leading-[52px] font-bold tracking-tight text-[#dae2fd]">
            {content.header.title}
          </h1>
          <div className="flex items-center gap-4 mt-5 flex-wrap">
            <div className="px-3 py-1 bg-[#57f1db]/10 border border-[#57f1db]/20 rounded-full flex items-center gap-2" dir="ltr">
              <span className="h-2 w-2 bg-[#57f1db] rounded-full animate-pulse" />
              <span className="vc-mono text-[11px] uppercase tracking-wider text-[#57f1db]">{content.effective.label}: {content.effective.date}</span>
            </div>
          </div>
          <p className="mt-6 max-w-3xl text-[18px] leading-relaxed text-[#bacac5]">{content.header.desc}</p>
          <div className="mt-6 max-w-3xl rounded-xl border border-[#57f1db]/20 bg-[#57f1db]/[0.07] px-5 py-4 text-[15px] leading-7 text-[#dae2fd]/90">
            {content.header.note}
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Sidebar table of contents */}
          <aside className="hidden lg:block lg:col-span-3 sticky top-28">
            <div className="flex flex-col gap-4">
              <h3 className="vc-mono text-[12px] uppercase tracking-widest text-[#bacac5]/70">{ui.toc}</h3>
              <nav className="vc-tocnav flex flex-col gap-3">
                {content.sections.map((section, i) => (
                  <a
                    key={i}
                    href={`#vc-sec-${i}`}
                    className={`vc-toc-link text-[14px] ${activeId === `vc-sec-${i}` ? 'active' : ''}`}
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
              <div className="vc-glass rounded-xl p-4 mt-4">
                <p className="text-[13px] leading-relaxed text-[#bacac5]">{content.effective.desc}</p>
              </div>
            </div>
          </aside>

          {/* Document content */}
          <article className="col-span-1 lg:col-span-9 vc-glass rounded-2xl p-5 md:p-12 shadow-2xl">
            <div className="vc-prose max-w-none">
              {content.sections.map((section, i) => (
                <section key={i} id={`vc-sec-${i}`} data-spy="true">
                  <h2>{i + 1}. {section.title}</h2>
                  <p>{section.summary}</p>
                  <ul>
                    {section.items.map((item, j) => (
                      <li key={j}>{item}</li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>

      {/* Footer */}
      <footer className="w-full py-8 mt-16 bg-[#060e20] border-t border-[#3c4a46]/20">
        <div className="max-w-[1280px] mx-auto px-5 lg:px-12 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex flex-col gap-2 items-center md:items-start">
            <span className="vc-display text-xl font-bold text-[#57f1db]">Vibecraft</span>
            <p className="text-[15px] text-[#bacac5]">© 2026 Vibecraft. {ui.rights}</p>
          </div>
          <div className="flex gap-6">
            <Link href="/policy" className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.policy}</Link>
            <a href={`mailto:${content.support.email}`} className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.support}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function PrivacyPage() {
  return <PrivacyContent />;
}
