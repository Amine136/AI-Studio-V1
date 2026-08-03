"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLanguage } from "@/context/LanguageContext";

const chrome = {
  en: { home: "Home", policy: "Policy", privacy: "Privacy", toc: "Table of Contents", ctaTitle: "Have questions about this policy?", ctaBtn: "Contact Support", rights: "All rights reserved.", support: "Support" },
  fr: { home: "Accueil", policy: "Politique", privacy: "Confidentialité", toc: "Table des matières", ctaTitle: "Des questions sur cette politique ?", ctaBtn: "Contacter le support", rights: "Tous droits réservés.", support: "Support" },
  ar: { home: "الرئيسية", policy: "السياسة", privacy: "الخصوصية", toc: "جدول المحتويات", ctaTitle: "هل لديك أسئلة حول هذه السياسة؟", ctaBtn: "تواصل مع الدعم", rights: "جميع الحقوق محفوظة.", support: "الدعم" },
} as const;

const policyLocales = {
  en: {
    header: {
      label: "Usage Policy",
      title: "The operating rules for Vibecraft accounts, credits, billing, and content generation.",
      desc: "This page defines the current production rules for account behavior, usage ceilings, acceptable use, credit billing, redemption controls, and suspension handling on Vibecraft.",
    },
    effective: {
      label: "Effective",
      date: "August 3, 2026",
      desc: "This policy applies to the current Vibecraft production workflow unless replaced by a later revision.",
    },
    support: {
      label: "Support",
      email: "contact@ouni.space",
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
          "Maximum 30 credits of usage per rolling 24-hour period.",
          "Smart analysis fees and generation charges count toward this rolling limit.",
          "Operator-side safety, credit, abuse, or provider limits may block requests before a requested action runs.",
        ],
      },
      {
        title: "Credits, Billing, And Refund Rules",
        summary: "How credits are consumed, when a charge should or should not happen, and what is refundable.",
        items: [
          "Vibecraft charges credits based on the active billing logic of the selected workflow or model.",
          "If Vibecraft cannot deliver a usable result, the user should not be charged for that failed result unless otherwise stated in-product.",
          "If a request succeeds and provider cost is already incurred, the delivered result may still be charged even if the final account balance becomes slightly negative.",
          "Standard Vibecraft credits do not expire unless a specific promotional credit explicitly says otherwise.",
          "Credits are non-transferable and are not intended to be traded, resold, or pooled across accounts.",
          "Credit purchases are billed either in Tunisian Dinar (TND) through the local payment gateways offered in the product, or in US Dollars (USD) by international card through our payment provider, which acts as merchant of record for that transaction.",
          "Returning reserved credits is not a money refund: the cost of a request is reserved before it runs, and if the result is not delivered the reserved credits are automatically returned to your balance — no charge is applied.",
          "A money refund covers only credits you have not used. Where a purchase is refundable, the amount refunded is the unconsumed share of that purchase — if you bought 70 credits and 30 remain unused, the refundable amount is 30/70 of the price paid. Credits already spent on delivered results are not refundable.",
          "When a purchase is refunded, the corresponding credits are removed from your balance. The credits created by that purchase are taken first; if they have already been partly spent, the difference is taken from the rest of your balance, including credits from redeemed codes.",
          "If your balance does not cover the full reversal, the remainder is recorded as a balance owed on your account and deducted from your next credit purchase or redeemed code. Your balance owed is shown in the balance details on the Credits page.",
          "A payment disputed with your card issuer pauses spending on the account until the dispute is resolved.",
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
        title: "Automated Content Moderation",
        summary: "How requests are screened for policy-violating content before processing, and the consequences of violations.",
        items: [
          "Every request is screened by automated content moderation before it is processed.",
          "Prohibited content includes, without limitation: sexual content involving minors, hateful or harassing content, violent or graphic content, self-harm, as well as any attempt to bypass moderation or abuse provider accounts.",
          "Requests that violate this policy are blocked and are not charged.",
          "Violations of this policy may result in temporary or permanent suspension of your account, depending on the nature and severity of the violation.",
          "Moderation is automated and may occasionally make mistakes; if you believe a request was blocked in error, contact Vibecraft Support at contact@ouni.space.",
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
          "If you believe an enforcement action or billing outcome is incorrect, contact Vibecraft Support at contact@ouni.space.",
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
      date: "3 août 2026",
      desc: "Cette politique s'applique au workflow de production actuel de Vibecraft à moins d'être remplacée par une révision ultérieure.",
    },
    support: {
      label: "Assistance",
      email: "contact@ouni.space",
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
        summary: "Comment les crédits sont consommés, quand des frais doivent ou ne doivent pas être appliqués, et ce qui est remboursable.",
        items: [
          "Vibecraft facture des crédits en fonction de la logique de facturation active du workflow ou du modèle sélectionné.",
          "Si Vibecraft ne peut pas fournir un résultat utilisable, l'utilisateur ne doit pas être facturé pour cet échec de génération, sauf indication contraire dans le produit.",
          "Si une demande réussit et qu'un coût fournisseur est déjà engagé, le résultat livré reste facturable même si le solde final du compte devient légèrement négatif.",
          "Les crédits Vibecraft standard n'expirent pas, à moins qu'un crédit promotionnel spécifique ne dise explicitement le contraire.",
          "Les crédits sont non transférables et ne sont pas destinés à être échangés, revendus ou mis en commun entre les comptes.",
          "Les achats de crédits sont facturés soit en dinar tunisien (TND) via les passerelles de paiement locales proposées dans le produit, soit en dollars américains (USD) par carte bancaire internationale via notre prestataire de paiement, qui agit en tant que revendeur officiel (merchant of record) pour cette transaction.",
          "La restitution des crédits réservés n'est pas un remboursement en argent : le coût d'une requête est réservé avant son exécution et, si le résultat n'est pas livré, les crédits réservés sont automatiquement restitués à votre solde — aucun montant n'est facturé.",
          "Un remboursement en argent ne porte que sur les crédits que vous n'avez pas utilisés. Lorsqu'un achat est remboursable, le montant remboursé correspond à la part non consommée de cet achat : si vous avez acheté 70 crédits et qu'il en reste 30 inutilisés, le montant remboursable est de 30/70 du prix payé. Les crédits déjà dépensés sur des résultats livrés ne sont pas remboursables.",
          "Lorsqu'un achat est remboursé, les crédits correspondants sont retirés de votre solde. Les crédits créés par cet achat sont prélevés en premier ; s'ils ont déjà été partiellement dépensés, la différence est prélevée sur le reste de votre solde, y compris les crédits issus de codes utilisés.",
          "Si votre solde ne couvre pas la totalité du remboursement, le reste est enregistré comme un solde dû sur votre compte et déduit de votre prochain achat de crédits ou code utilisé. Votre solde dû est affiché dans le détail du solde sur la page Crédits.",
          "Un paiement contesté auprès de votre banque émettrice suspend les dépenses sur le compte jusqu'à la résolution du litige.",
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
        title: "Modération Automatique du Contenu",
        summary: "Comment les requêtes sont analysées pour détecter tout contenu interdit avant traitement, et les conséquences en cas de violation.",
        items: [
          "Chaque requête est analysée par une modération de contenu automatisée avant d'être traitée.",
          "Le contenu interdit comprend, sans s'y limiter : le contenu sexuel impliquant des mineurs, le contenu haineux ou de harcèlement, le contenu violent ou explicite, l'automutilation, ainsi que toute tentative de contourner la modération ou d'abuser des comptes des fournisseurs.",
          "Les requêtes qui violent cette politique sont bloquées et ne sont pas facturées.",
          "Toute violation de cette politique peut entraîner une suspension temporaire ou permanente de votre compte, selon la nature et la gravité de la violation.",
          "La modération est automatisée et peut parfois commettre des erreurs ; si vous pensez qu'une requête a été bloquée par erreur, contactez le support de Vibecraft à contact@ouni.space.",
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
          "Si vous pensez qu'une mesure d'application ou un résultat de facturation est incorrect, contactez le support de Vibecraft à contact@ouni.space.",
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
      date: "3 أغسطس 2026",
      desc: "تنطبق هذه السياسة على سير عمل إنتاج Vibecraft الحالي ما لم يتم استبدالها بمراجعة لاحقة.",
    },
    support: {
      label: "الدعم الفني",
      email: "contact@ouni.space",
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
        summary: "كيف يتم استهلاك الأرصدة، ومتى يجب أو لا يجب احتساب رسوم، وما هو القابل للاسترداد.",
        items: [
          "يفرض Vibecraft رسومًا على الأرصدة بناءً على منطق الفوترة النشط لسير العمل أو النموذج المحدد.",
          "إذا لم يتمكن Vibecraft من تقديم نتيجة قابلة للاستخدام، فلا ينبغي فرض رسوم على المستخدم مقابل هذه النتيجة الفاشلة ما لم ينص على خلاف ذلك داخل المنتج.",
          "إذا نجح الطلب وتم تكبد تكلفة المزود بالفعل، فقد تظل النتيجة المسلمة مشحونة حتى إذا أصبح الرصيد النهائي للحساب سالبًا بشكل طفيف.",
          "لا تنتهي صلاحية أرصدة Vibecraft القياسية ما لم ينص رصيد ترويجي محدد صراحة على خلاف ذلك.",
          "الأرصدة غير قابلة للتحويل ولا يُقصد تداولها أو إعادة بيعها أو تجميعها عبر الحسابات.",
          "تتم فوترة شراء الأرصدة إما بالدينار التونسي (TND) عبر بوابات الدفع المحلية المتوفرة داخل المنتج، أو بالدولار الأمريكي (USD) عبر بطاقة بنكية دولية من خلال مزود الدفع لدينا، الذي يعمل كبائع رسمي (merchant of record) لتلك المعاملة.",
          "إعادة الأرصدة المحجوزة ليست استردادًا نقديًا: يتم حجز تكلفة الطلب قبل تنفيذه، وإذا لم تُسلَّم النتيجة تُعاد الأرصدة المحجوزة تلقائيًا إلى رصيدك — دون احتساب أي رسوم.",
          "لا يشمل الاسترداد النقدي إلا الأرصدة التي لم تستخدمها. عندما تكون عملية الشراء قابلة للاسترداد، يكون المبلغ المسترد هو الحصة غير المستهلكة من تلك العملية: إذا اشتريت 70 رصيدًا وبقي 30 غير مستخدم، فإن المبلغ القابل للاسترداد هو 30/70 من السعر المدفوع. أما الأرصدة التي أُنفقت بالفعل على نتائج مُسلَّمة فهي غير قابلة للاسترداد.",
          "عند استرداد عملية شراء، تُخصم الأرصدة المقابلة من رصيدك. تُؤخذ أولًا الأرصدة الناتجة عن تلك العملية؛ وإذا كانت قد أُنفقت جزئيًا، يُؤخذ الفرق من بقية رصيدك، بما في ذلك الأرصدة الناتجة عن الرموز المستخدمة.",
          "إذا لم يغطِّ رصيدك قيمة الاسترداد بالكامل، يُسجَّل الباقي كرصيد مستحق على حسابك ويُخصم من عملية شراء الأرصدة التالية أو من الرمز الذي تستخدمه. ويظهر الرصيد المستحق ضمن تفاصيل الرصيد في صفحة الأرصدة.",
          "الاعتراض على عملية دفع لدى الجهة المُصدِرة لبطاقتك يوقف الإنفاق على الحساب مؤقتًا حتى تتم تسوية النزاع.",
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
        title: "الإشراف التلقائي على المحتوى",
        summary: "كيفية فحص الطلبات بحثًا عن محتوى مخالف للسياسة قبل معالجتها، وعواقب المخالفات.",
        items: [
          "تتم مراجعة كل طلب بواسطة نظام إشراف تلقائي على المحتوى قبل معالجته.",
          "يشمل المحتوى المحظور، على سبيل المثال لا الحصر: المحتوى الجنسي المتعلق بالقاصرين، والمحتوى الذي يحضّ على الكراهية أو التحرش، والمحتوى العنيف أو الصادم، وإيذاء النفس، بالإضافة إلى أي محاولة لتجاوز الإشراف أو إساءة استخدام حسابات المزوّدين.",
          "يتم حظر الطلبات التي تخالف هذه السياسة ولا يتم احتساب أي رسوم عليها.",
          "قد تؤدي مخالفة هذه السياسة إلى تعليق حسابك مؤقتًا أو دائمًا، وذلك بحسب طبيعة المخالفة وخطورتها.",
          "الإشراف تلقائي وقد يرتكب أخطاءً أحيانًا؛ إذا كنت تعتقد أن طلبًا قد حُظر عن طريق الخطأ، فتواصل مع دعم Vibecraft على contact@ouni.space.",
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
          "إذا كنت تعتقد أن إجراء الإنفاذ أو نتيجة الفوترة غير صحيحة، فاتصل بدعم Vibecraft على contact@ouni.space.",
        ],
      },
    ],
  },
};

function PolicyContent() {
  const { language, setLanguage } = useLanguage();
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState("");

  // Language fallback
  const currentLang = (language && policyLocales[language as keyof typeof policyLocales]) ? language as keyof typeof policyLocales : 'en';
  const content = policyLocales[currentLang];
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
    <div className="vc-policy min-h-screen bg-[#0b1326] text-[#dae2fd] selection:bg-[#57f1db]/30" dir={isRtl ? 'rtl' : 'ltr'}>
      <style dangerouslySetInnerHTML={{ __html: `
        @import url('https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;600;700;800&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
        .vc-policy { font-family: 'Inter', system-ui, sans-serif; scroll-behavior: smooth; }
        .vc-display { font-family: 'Hanken Grotesk', system-ui, sans-serif; }
        .vc-mono { font-family: 'JetBrains Mono', monospace; }
        .vc-policy-content h2 { font-family: 'Hanken Grotesk', sans-serif; font-size: 24px; font-weight: 600; margin-top: 48px; margin-bottom: 20px; color: #57f1db; scroll-margin-top: 120px; }
        .vc-policy-content p { margin-bottom: 16px; line-height: 1.7; }
        .vc-policy-content ul { margin-bottom: 24px; padding-left: 1.5rem; }
        .vc-policy-content li { position: relative; margin-bottom: 12px; list-style: none; line-height: 1.7; color: rgba(218, 226, 253, 0.9); }
        .vc-policy-content li::before { content: ""; position: absolute; left: -1.5rem; top: 0.7rem; width: 8px; height: 2px; background-color: #57f1db; }
        [dir="rtl"] .vc-policy-content ul { padding-left: 0; padding-right: 1.5rem; }
        [dir="rtl"] .vc-policy-content li::before { left: auto; right: -1.5rem; }
        .vc-glass { background: rgba(15, 23, 42, 0.6); backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); border: 1px solid rgba(255, 255, 255, 0.06); }
        .vc-tocnav { border-left: 1px solid rgba(60, 74, 70, 0.35); }
        [dir="rtl"] .vc-tocnav { border-left: none; border-right: 1px solid rgba(60, 74, 70, 0.35); }
        .vc-toc-link { display: block; padding-left: 1rem; border-left: 2px solid transparent; transition: color .2s, border-color .2s; color: #9fb0ab; }
        .vc-toc-link:hover { color: #57f1db; }
        .vc-toc-link.active { color: #57f1db; border-left-color: #57f1db; }
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
              <span className="text-[15px] text-[#57f1db] font-semibold border-b-2 border-[#57f1db] pb-1">{ui.policy}</span>
              <Link href="/privacy" className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.privacy}</Link>
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
        <div className="flex flex-col md:flex-row gap-10">
          {/* Sidebar table of contents */}
          <aside className="hidden md:block w-64 shrink-0">
            <div className="sticky top-28 space-y-4">
              <h3 className="vc-mono text-[12px] uppercase tracking-widest text-[#bacac5]/70">{ui.toc}</h3>
              <nav className="vc-tocnav flex flex-col gap-3">
                {content.sections.map((section, i) => (
                  <a
                    key={i}
                    href={`#vc-sec-${i}`}
                    className={`vc-toc-link text-[15px] ${activeId === `vc-sec-${i}` ? 'active' : ''}`}
                  >
                    {section.title}
                  </a>
                ))}
              </nav>
              <div className="vc-glass rounded-xl p-4 mt-6">
                <span className="vc-mono text-[10px] uppercase tracking-tight text-[#62fae3] block mb-1">{content.effective.label}</span>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-[#57f1db] animate-pulse" />
                  <span className="text-[15px] font-medium text-[#dae2fd]">{content.effective.date}</span>
                </div>
              </div>
            </div>
          </aside>

          {/* Main content */}
          <div className="flex-1 max-w-3xl">
            <div className="mb-16">
              <div className="flex items-center gap-3 mb-4">
                <span className="vc-mono bg-[#57f1db]/10 text-[#57f1db] text-[12px] px-3 py-1 rounded-full border border-[#57f1db]/20 uppercase tracking-wider">
                  {content.header.label}
                </span>
              </div>
              <h1 className="vc-display text-3xl sm:text-[44px] sm:leading-[52px] font-bold tracking-tight text-[#dae2fd] mb-5">
                {content.header.title}
              </h1>
              <p className="text-[18px] leading-relaxed text-[#bacac5]">{content.header.desc}</p>
            </div>

            <div className="vc-policy-content text-[16px]">
              {content.sections.map((section, i) => (
                <div key={i}>
                  {i > 0 && <div className="h-px w-full bg-[#3c4a46]/25 my-8" />}
                  <section id={`vc-sec-${i}`} data-spy="true">
                    <h2>{i + 1}. {section.title}</h2>
                    <p className="text-[#bacac5]">{section.summary}</p>
                    <ul>
                      {section.items.map((item, j) => (
                        <li key={j}>{item}</li>
                      ))}
                    </ul>
                  </section>
                </div>
              ))}
            </div>

            {/* Important note */}
            <div className="vc-glass rounded-2xl p-6 sm:p-8 mt-12">
              <span className="vc-mono text-[12px] uppercase tracking-widest text-[#bacac5]/70">{content.footer.label}</span>
              <h3 className="vc-display text-xl font-semibold text-[#57f1db] mt-3 mb-2">{content.footer.title}</h3>
              <p className="text-[#bacac5] max-w-2xl leading-relaxed">{content.footer.desc}</p>
            </div>

            {/* Contact CTA */}
            <div className="mt-10 p-8 rounded-2xl bg-[#222a3d] border border-[#3c4a46]/30 flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h4 className="vc-display text-xl font-semibold text-[#57f1db] mb-2">{ui.ctaTitle}</h4>
                <p className="text-[#bacac5] max-w-md">{content.support.desc}</p>
              </div>
              <a
                href={`mailto:${content.support.email}`}
                className="whitespace-nowrap border border-[#57f1db] text-[#57f1db] px-8 py-3 rounded-full font-semibold hover:bg-[#57f1db]/10 transition-colors"
              >
                {ui.ctaBtn}
              </a>
            </div>
          </div>
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
            <Link href="/privacy" className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.privacy}</Link>
            <a href={`mailto:${content.support.email}`} className="text-[15px] text-[#bacac5] hover:text-[#57f1db] transition-colors">{ui.support}</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default function PolicyPage() {
  return <PolicyContent />;
}
