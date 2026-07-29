// Default resume content. The app loads this on first run (and after "Reset").
// Your edits are stored in the browser (localStorage), not in this file.
// Text fields may contain <b> and <i> tags for inline formatting.
window.RESUME_DATA = {
  settings: { ats: false },
  sectionOrder: {
    left: ["experience", "education"],
    right: ["skills", "projects", "achievements", "languages", "interests"]
  },
  // Section keys left out of the resume. They keep their content and their slot in sectionOrder.
  hiddenSections: [],
  photo: window.RESUME_PHOTO || "",
  name: "Alex Morgan",
  title: "Senior Android Engineer @ Example Co.",
  summary:
    "Android developer with <b>6+ yrs of experience</b> building consumer apps in <b>Kotlin</b> and <b>Java</b>. " +
    "Comfortable across the stack, from <b>Jetpack Compose</b> UIs to backend APIs, with a focus on " +
    "<b>performance</b>, <b>reliability</b> and clean architecture.",
  contact: {
    email: "alex.morgan@example.com",
    phone: "+1-555-0100",
    location: "Springfield, USA",
    linkedin: "linkedin.com/in/example"
  },
  headings: {
    experience: "EXPERIENCE",
    education: "EDUCATION",
    skills: "SKILLS",
    projects: "PERSONAL PROJECTS",
    achievements: "ACHIEVEMENTS",
    languages: "LANGUAGES",
    interests: "INTERESTS"
  },
  experience: [
    {
      role: "Senior Android Engineer",
      org: "Example Co.",
      url: "",
      dates: "01/2023 - Present",
      location: "Remote",
      label: "Responsibilities",
      bullets: [
        "Lead Android development for a consumer app with <b>1M+ monthly users</b>.",
        "Migrated 25+ screens from XML to <b>Jetpack Compose</b>, cutting UI code by roughly a third.",
        "Reduced cold-start time from ~5s to under 2s by profiling and deferring startup work."
      ]
    },
    {
      role: "Android Engineer",
      org: "Sample Labs",
      url: "",
      dates: "06/2020 - 12/2022",
      location: "Springfield, USA",
      label: "Responsibilities",
      bullets: [
        "Built and maintained an internal <b>analytics SDK</b> used by 4 product teams.",
        "Worked with QA, design and product to plan and ship bi-weekly releases."
      ]
    },
    {
      role: "Junior Developer",
      org: "Placeholder Inc.",
      url: "",
      dates: "07/2018 - 05/2020",
      location: "Shelbyville, USA",
      label: "Responsibilities",
      bullets: [
        "Shipped features and bug fixes for a field-service Android app.",
        "Wrote unit and UI tests that raised coverage from 20% to 60%."
      ]
    }
  ],
  education: [
    {
      degree: "Bachelor of Science - Computer Science",
      school: "State University",
      dates: "08/2014 - 05/2018",
      meta: "GPA : 3.7/4.0",
      label: "Achievements",
      bullets: [
        "President of the university programming club for two years."
      ]
    }
  ],
  skills: [
    "Kotlin", "Java", "Jetpack Compose", "Coroutines", "Firebase", "REST APIs",
    "Gradle", "Unit Testing", "CI/CD", "Python", "Git"
  ],
  projects: [
    {
      name: "Transit Arrivals Board",
      url: "",
      bullets: [
        "A live departures board for local public transport, built with React and Express.",
        "Uses server-sent events and caching to stay within a rate-limited public API."
      ]
    },
    {
      name: "Personal Finance Tracker",
      url: "",
      bullets: [
        "An offline-first Android app for tracking expenses, built with Room and Compose."
      ]
    }
  ],
  achievements: [
    {
      title: "Engineering Excellence Award (2024)",
      desc: "Recognised for leading a performance initiative across the mobile team."
    }
  ],
  languages: [
    { name: "English", level: "Native or Bilingual Proficiency" },
    { name: "Spanish", level: "Professional Working Proficiency" },
    { name: "French", level: "Elementary Proficiency" }
  ],
  interests: ["Hiking", "Photography", "Chess", "Cooking"]
};
