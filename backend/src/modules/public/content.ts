export const platformContent = {
  branding: {
    platformName: "Foodex",
    tagline: "Eat & Smile",
  },
  customerApp: {
    homeBanner: {
      isActive: false,
      title: "Fresh picks near you",
      subtitle:
        "Discover curated restaurants, live offers, and nearby favorites.",
      ctaLabel: "Browse all",
      ctaPath: "/(tabs)/browse",
      tone: "sky",
    },
    homeCms: {
      offerStrip: {
        isActive: true,
        showVoucherStrip: true,
        mode: "voucher_strip",
        title: "Fresh offers near you",
        subtitle: "Limited-time savings from restaurants around you.",
        variant: "text",
        buttonStyle: "pill",
        imageUrl: "",
        imagePublicId: "",
        carouselImageUrls: [],
        carouselImages: [],
        ctaLabel: "Browse offers",
        ctaPath: "/(tabs)/browse",
        backgroundColor: "#FFF0F6",
        textColor: "#3F2432",
        accentColor: "#FF5C93",
      },
      modal: {
        isActive: false,
        title: "Special offer",
        subtitle: "Open the app and discover fresh deals today.",
        imageUrl: "",
        imagePublicId: "",
        ctaLabel: "Explore now",
        ctaPath: "/(tabs)/browse",
        delaySeconds: 3,
        frequency: "once_per_session",
        backgroundColor: "#FFFFFF",
        textColor: "#2B1D24",
        accentColor: "#FF5C93",
      },
      howToOrderGuide: {
        isActive: false,
        audience: "all_users",
        title: "How to order on Foodex",
        subtitle: "Watch a quick guide or follow the image steps.",
        youtubeUrl: "",
        ctaLabel: "Watch guide",
        placement: "after_offers",
        backgroundColor: "#EDF4FF",
        textColor: "#24406F",
        accentColor: "#5D8BFF",
        guideImages: [],
      },
      pushCampaign: {
        contentType: "text",
        title: "Fresh offers are live",
        body: "Open Foodex and discover offers near you.",
        imageUrl: "",
        imagePublicId: "",
        path: "/(tabs)/browse",
        currentCampaignId: "",
        audienceType: "all_users",
        selectedCustomerIds: [],
        customerGroupKey: "",
        restaurantScope: "all_restaurants",
        selectedRestaurantIds: [],
        abTest: {
          enabled: false,
          splitPercent: 50,
          variantBTitle: "",
          variantBBody: "",
          variantBPath: "",
        },
        lastSentAt: null,
        totalTargets: 0,
        sentCount: 0,
        disabledCount: 0,
        openCount: 0,
        recipientEvents: [],
        openEvents: [],
        receiptCheckedAt: null,
        conversionWindowDays: 7,
        scheduledAt: null,
        scheduleStatus: "none",
        scheduledByAdminId: "",
        scheduledCreatedAt: null,
        scheduleHistory: [],
        conversions: {
          orderCount: 0,
          deliveredOrderCount: 0,
          deliveredRevenue: 0,
          uniqueOrderingCustomers: 0,
          conversionRate: 0,
          refreshedAt: null,
          convertedOrders: [],
        },
        campaignHistory: [],
      },
      analytics: {
        stripImpressions: 0,
        stripClicks: 0,
        blockImpressions: 0,
        blockClicks: 0,
        modalImpressions: 0,
        modalClicks: 0,
        guideImpressions: 0,
        guideVideoClicks: 0,
        guideImageClicks: 0,
        pushOpens: 0,
        lastEventAt: null,
      },
      analyticsEvents: [],
    },
  },
  operations: {
    serviceArea: {
      name: "Netrokona service area",
      centerLatitude: 24.8771096,
      centerLongitude: 90.7248271,
      radiusKm: 3,
    },
    deliveryPricing: {
      baseFeeTaka: 20,
      distanceSurchargeEnabled: false,
      surchargeStartsAfterKm: 2,
      surchargeStepMeters: 500,
      surchargeAmountTaka: 5,
    },
    dispatch: {
      autoAssignmentEnabled: true,
      autoReassignTimedOutOrders: true,
      dispatchMode: "fleet",
      primaryRiderId: "",
      primaryRiderFallbackEnabled: true,
      algorithm: "nearest_eligible_balanced",
      ownerAcceptanceTimeoutMinutes: 5,
      maxActiveOrdersPerRider: 3,
      staleLocationCutoffMinutes: 20,
      assignmentTimeoutMinutes: 8,
      prepStartGraceMinutes: 8,
      prepLateGraceMinutes: 5,
      pickupLateGraceMinutes: 10,
      deliveryLateGraceMinutes: 10,
      retryCooldownMinutes: 3,
      surgeReadyOrderThreshold: 4,
      surgeUnassignedOrderThreshold: 2,
      autoCancelUnacceptedOrdersEnabled: false,
      autoCancelAfterMinutes: 12,
      autoCancelNotifyBeforeMinutes: 3,
    },
  },
  supportContact: {
    email: "support@foodex.com",
    phone: "01700000000",
    supportHours: "Daily, 9:00 AM - 11:00 PM",
    reportLabel: "Report Issue",
    directHelpNote:
      "Use report issue for trackable support, or contact support directly for urgent help.",
  },
  helpCenter: {
    categories: [
      {
        id: "orders",
        name: "Orders & Delivery",
        description:
          "Order flow, cancellations, rider handoff, and delivery delays.",
        iconKey: "shopping-bag",
      },
      {
        id: "payments",
        name: "Payments & Payouts",
        description: "Balance, settlements, payout timing, and payment issues.",
        iconKey: "credit-card",
      },
      {
        id: "menu",
        name: "Menu & Items",
        description: "Categories, items, variants, and item visibility.",
        iconKey: "utensils-crossed",
      },
      {
        id: "offers",
        name: "Offers & Promotions",
        description: "Voucher setup, discount logic, and usage tracking.",
        iconKey: "percent",
      },
      {
        id: "account",
        name: "Account & Settings",
        description: "Store profile, opening hours, and dashboard settings.",
        iconKey: "settings",
      },
      {
        id: "technical",
        name: "Technical Issues",
        description: "Bugs, loading issues, and unexpected system behavior.",
        iconKey: "bug",
      },
    ],
    articles: [
      {
        id: "accept-order",
        categoryId: "orders",
        title: "How to accept an incoming order",
        excerpt:
          "Review, accept, and prepare orders without slowing down the kitchen.",
        readTime: "3 min read",
        sections: [
          {
            title: "Checklist",
            bullets: [
              "Check item availability.",
              "Confirm preparation time.",
              "Review customer notes before accepting.",
            ],
          },
          {
            title: "Steps",
            steps: [
              "Open Live Orders.",
              "Review the order.",
              "Click Accept.",
              "Move it through preparation statuses.",
            ],
          },
        ],
      },
      {
        id: "payouts",
        categoryId: "payments",
        title: "Why balance stays pending before payout",
        excerpt: "Learn when earnings move from pending to available balance.",
        readTime: "4 min read",
        sections: [
          {
            title: "Settlement logic",
            paragraphs: [
              "Recent orders remain pending until the settlement delay completes.",
              "Once eligible, earnings move into available balance automatically.",
            ],
          },
        ],
      },
      {
        id: "voucher",
        categoryId: "offers",
        title: "How to create a voucher properly",
        excerpt:
          "Set date range, usage limits, and the right offer type from the start.",
        readTime: "5 min read",
        sections: [
          {
            title: "Best practice",
            bullets: [
              "Use threshold offers for auto-applied discounts.",
              "Use coupon codes for campaign tracking.",
              "Set clear total and per-user limits.",
            ],
          },
        ],
      },
    ],
    faqs: [
      {
        id: "faq-1",
        categoryId: "orders",
        question: "How do I accept an order?",
        answer:
          "Open Live Orders, review the order, then click Accept to move it into the preparation flow.",
      },
      {
        id: "faq-2",
        categoryId: "payments",
        question: "Why is my balance pending?",
        answer:
          "Orders stay pending until the settlement window finishes. After that, eligible earnings move to available balance.",
      },
      {
        id: "faq-3",
        categoryId: "offers",
        question: "How do I create a voucher?",
        answer:
          "Go to Promotions, click Add Voucher, then configure type, value, date range, limits, and applicability.",
      },
      {
        id: "faq-4",
        categoryId: "technical",
        question: "What if the dashboard is loading slowly?",
        answer:
          "Refresh the page, check internet stability, and contact support with a screenshot if the issue continues.",
      },
    ],
  },
  legal: {
    privacyPolicy: {
      title: "Privacy Policy",
      label: "Privacy & Data",
      description:
        "Learn how Foodex handles owner, business, and operational data across onboarding and dashboard usage.",
      lastUpdated: "12 April 2026",
      effectiveDate: "12 April 2026",
      overviewTitle: "Data handling overview",
      overviewDescription:
        "We aim to collect only the information needed to operate the platform, support restaurants, process orders, and maintain compliance and service reliability.",
      trustTitle: "Trust and protection",
      trustDescription:
        "If you need privacy-related clarification, support can guide you through access, update, or deletion requests where applicable.",
      sections: [
        {
          id: "introduction",
          title: "Introduction",
          body: [
            "This Privacy Policy explains how Foodex collects, uses, stores, and protects information from restaurant owners and related users of the platform.",
            "It applies to onboarding, dashboard usage, operational management, support requests, and other interactions with the Foodex restaurant owner platform.",
            "Effective date: 12 April 2026.",
          ],
        },
        {
          id: "information-we-collect",
          title: "Information We Collect",
          body: [
            "We may collect personal information such as owner name, phone number, and optional email address.",
            "We may collect business information such as restaurant details, address, opening hours, payout details, menu data, and supporting documents submitted for review.",
            "We may also collect usage and analytics data such as dashboard interactions, feature usage, device context, and operational activity logs.",
          ],
        },
        {
          id: "how-we-use-information",
          title: "How We Use Information",
          body: [
            "We use information to process orders, manage restaurant accounts, support onboarding review, and operate dashboard tools.",
            "We use information to improve platform quality, business workflows, analytics, notifications, and support experiences.",
            "We may use contact information for important communications such as verification, support follow-up, policy notices, and account-related alerts.",
          ],
        },
        {
          id: "sharing-of-information",
          title: "Sharing of Information",
          body: [
            "We may share limited information with delivery partners when needed to fulfill delivery operations.",
            "We may share payout or settlement-related information with payment providers when applicable.",
            "We may disclose information when required by law, regulation, legal request, or fraud-prevention obligations.",
            "We do not sell restaurant owner data to third parties.",
          ],
        },
        {
          id: "data-storage-security",
          title: "Data Storage & Security",
          body: [
            "Information may be stored in secure systems used to operate Foodex services and internal administrative workflows.",
            "We use reasonable technical and organizational measures to protect personal, business, and operational data against unauthorized access, misuse, or loss.",
            "Owners are also responsible for protecting credentials, devices, and account access.",
          ],
        },
        {
          id: "cookies-tracking",
          title: "Cookies & Tracking",
          body: [
            "Foodex may use cookies or similar technologies for authentication, preferences, session continuity, analytics, and service performance.",
            "Basic tracking may be used to understand product usage patterns and improve dashboard reliability and support experience.",
          ],
        },
        {
          id: "user-rights",
          title: "User Rights",
          body: [
            "Restaurant owners may request access to their data, update inaccurate information, or request deletion where applicable under platform policy or law.",
            "Some information may need to be retained for legal, operational, fraud-prevention, payout, or compliance reasons.",
          ],
        },
        {
          id: "data-retention",
          title: "Data Retention",
          body: [
            "We retain information only as long as reasonably necessary for operational use, compliance, dispute resolution, fraud prevention, and service improvement.",
            "Retention periods may vary depending on account status, payout history, support records, and legal obligations.",
          ],
        },
        {
          id: "changes-to-policy",
          title: "Changes to Policy",
          body: [
            "We may update this Privacy Policy when platform features, legal obligations, or data practices change.",
            "Where appropriate, we may notify owners through email, dashboard notices, or onboarding/account communications.",
          ],
        },
        {
          id: "contact-information",
          title: "Contact Information",
          body: [
            "For privacy questions or requests, contact support@foodbela.com.",
            "You may also reach support by phone at 01700000000.",
          ],
        },
      ],
    },
    termsAndConditions: {
      title: "Terms & Conditions",
      label: "Legal Terms",
      description:
        "Read how owner accounts, onboarding, orders, and payouts are governed inside the Foodex restaurant dashboard.",
      noticeTitle: "Owner Agreement Notice",
      noticeDescription:
        "These terms apply to restaurant owners using Foodex for onboarding, dashboard access, order handling, payouts, and related operational workflows. Please read them carefully before continuing with account creation or store submission.",
      sections: [
        {
          id: "introduction",
          title: "Introduction",
          body: [
            "These Terms & Conditions govern how restaurant owners use the Foodex dashboard, onboarding flow, and operational tools.",
            "By creating an account or submitting a restaurant for review, you agree to follow these terms while using the platform.",
          ],
        },
        {
          id: "account-terms",
          title: "Account Terms",
          body: [
            "You are responsible for keeping your phone number, password, and optional email up to date and secure.",
            "You must provide accurate business and owner information during sign up, onboarding, and later account updates.",
            "Foodex may suspend access if false information, unauthorized access, or suspicious activity is detected.",
          ],
        },
        {
          id: "orders-responsibilities",
          title: "Orders & Responsibilities",
          body: [
            "Restaurant owners are responsible for accepting, preparing, and updating orders accurately inside the dashboard.",
            "Menu availability, pricing, opening hours, and store status should be kept correct so customers receive reliable information.",
            "You are responsible for fulfilling orders according to platform policies and communicating issues quickly when operational problems happen.",
          ],
        },
        {
          id: "payments-payouts",
          title: "Payments & Payouts",
          body: [
            "Payout amounts may reflect commissions, discounts, delivery-cost adjustments, refunds, or other platform rules described in your payout reports.",
            "You are responsible for keeping payout details accurate, including bank or bKash information.",
            "Foodex may delay or hold payouts if account review, settlement verification, or fraud checks are required.",
          ],
        },
        {
          id: "prohibited-activities",
          title: "Prohibited Activities",
          body: [
            "You may not submit false business information, manipulate orders, abuse promotions, or misuse customer data.",
            "You may not use the dashboard for unlawful, abusive, deceptive, or unauthorized commercial activities.",
            "Automated abuse, credential sharing, and intentional disruption of platform operations are strictly prohibited.",
          ],
        },
        {
          id: "termination",
          title: "Termination",
          body: [
            "Foodex may suspend, reject, or terminate account access if these terms are violated or if required business information cannot be verified.",
            "Restaurant owners may request account closure, though legal, financial, or payout obligations may continue where necessary.",
          ],
        },
        {
          id: "liability",
          title: "Liability",
          body: [
            "Foodex provides the dashboard and related tools on a best-effort basis and may update features, workflows, or operational requirements over time.",
            "We are not responsible for losses caused by inaccurate owner-provided data, unauthorized access resulting from weak credential security, or service interruptions outside our reasonable control.",
          ],
        },
        {
          id: "changes-to-terms",
          title: "Changes to Terms",
          body: [
            "Foodex may update these Terms & Conditions when platform features, legal requirements, or operational policies change.",
            "Material updates may be shown through dashboard notices, onboarding notices, or other account communications.",
          ],
        },
      ],
    },
  },
} as const;
