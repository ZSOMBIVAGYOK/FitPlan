// ============================================================
// garmin-sports.js — Hivatalos Garmin Sportágak katalógusa
// FitPlan Pro | PR Hub és Edzés modulhoz
// ============================================================

export const GARMIN_SPORTS = [
  // Futás
  { id: "running", name: "Futás", cat: "Futás", icon: "fa-solid fa-person-running", isCardio: true },
  { id: "trail_running", name: "Terepfutás", cat: "Futás", icon: "fa-solid fa-mountain", isCardio: true },
  { id: "treadmill", name: "Futópad", cat: "Futás", icon: "fa-solid fa-person-walking", isCardio: true },
  { id: "track_running", name: "Pályafutás", cat: "Futás", icon: "fa-solid fa-stopwatch", isCardio: true },

  // Kerékpár
  { id: "cycling", name: "Kerékpározás", cat: "Kerékpár", icon: "fa-solid fa-bicycle", isCardio: true },
  { id: "road_biking", name: "Országúti kerékpár", cat: "Kerékpár", icon: "fa-solid fa-bicycle", isCardio: true },
  { id: "mountain_biking", name: "Mountain Bike (MTB)", cat: "Kerékpár", icon: "fa-solid fa-mountain-sun", isCardio: true },
  { id: "indoor_cycling", name: "Szobakerékpár / Spinning", cat: "Kerékpár", icon: "fa-solid fa-bicycle", isCardio: true },
  { id: "gravel_biking", name: "Gravel kerékpár", cat: "Kerékpár", icon: "fa-solid fa-bicycle", isCardio: true },

  // Úszás
  { id: "pool_swimming", name: "Medencés úszás", cat: "Úszás", icon: "fa-solid fa-person-swimming", isCardio: true },
  { id: "open_water_swimming", name: "Nyíltvízi úszás", cat: "Úszás", icon: "fa-solid fa-water", isCardio: true },

  // Erőnlét & Fitnesz
  { id: "strength_training", name: "Erőnléti edzés / Súlyzós", cat: "Erőnlét", icon: "fa-solid fa-dumbbell", isStrength: true },
  { id: "powerlifting", name: "Erőemelés / Powerlifting", cat: "Erőnlét", icon: "fa-solid fa-weight-hanging", isStrength: true },
  { id: "bodybuilding", name: "Testépítés", cat: "Erőnlét", icon: "fa-solid fa-dumbbell", isStrength: true },
  { id: "calisthenics", name: "Saját testsúlyos (Calisthenics)", cat: "Erőnlét", icon: "fa-solid fa-person-rays", isStrength: true },
  { id: "cardio", name: "Kardió edzés", cat: "Fitnesz", icon: "fa-solid fa-heart-pulse", isCardio: true },
  { id: "hiit", name: "HIIT / Intervallum", cat: "Fitnesz", icon: "fa-solid fa-bolt-lightning", isCardio: true },
  { id: "crossfit", name: "CrossFit / Funkcionális", cat: "Fitnesz", icon: "fa-solid fa-fire", isStrength: true },
  { id: "stair_stepper", name: "Lépcsőzés (StairMaster)", cat: "Fitnesz", icon: "fa-solid fa-stairs", isCardio: true },
  { id: "elliptical", name: "Elliptikus tréner", cat: "Fitnesz", icon: "fa-solid fa-person-walking", isCardio: true },

  // Wellness & Regeneráció
  { id: "yoga", name: "Jóga", cat: "Wellness", icon: "fa-solid fa-spa" },
  { id: "pilates", name: "Pilates", cat: "Wellness", icon: "fa-solid fa-child-reaching" },
  { id: "breathwork", name: "Légzésgyakorlat", cat: "Wellness", icon: "fa-solid fa-wind" },

  // Evezés & Vízi sportok
  { id: "indoor_rowing", name: "Beltéri evezőpad", cat: "Fitnesz", icon: "fa-solid fa-water", isCardio: true },
  { id: "rowing", name: "Evezés (vízen)", cat: "Vízi sport", icon: "fa-solid fa-sailboat", isCardio: true },
  { id: "sup", name: "Stand Up Paddle (SUP)", cat: "Vízi sport", icon: "fa-solid fa-person-snowboarding", isCardio: true },
  { id: "kayaking", name: "Kajak / Kenu", cat: "Vízi sport", icon: "fa-solid fa-sailboat", isCardio: true },

  // Szabadtér & Téli sportok
  { id: "walking", name: "Gyaloglás", cat: "Szabadtér", icon: "fa-solid fa-person-walking", isCardio: true },
  { id: "hiking", name: "Túrázás", cat: "Szabadtér", icon: "fa-solid fa-mountain", isCardio: true },
  { id: "climbing", name: "Falmászás / Boulder", cat: "Extrém", icon: "fa-solid fa-mountain" },
  { id: "skiing", name: "Síelés", cat: "Téli sport", icon: "fa-solid fa-person-skiing", isCardio: true },
  { id: "snowboarding", name: "Snowboard", cat: "Téli sport", icon: "fa-solid fa-snowflake", isCardio: true },
  { id: "cross_country_skiing", name: "Sífutás", cat: "Téli sport", icon: "fa-solid fa-person-skiing-nordic", isCardio: true },

  // Egyéb & Multisport
  { id: "triathlon", name: "Triatlon", cat: "Multisport", icon: "fa-solid fa-medal", isCardio: true },
  { id: "tennis", name: "Tenisz", cat: "Labdasport", icon: "fa-solid fa-baseball", isCardio: true },
  { id: "padel", name: "Padel", cat: "Labdasport", icon: "fa-solid fa-table-tennis-paddle-ball", isCardio: true },
  { id: "golf", name: "Golf", cat: "Szabadtér", icon: "fa-solid fa-golf-ball-tee" }
];

export function getSportById(id) {
  return GARMIN_SPORTS.find(s => s.id === id) || {
    id: id || "other",
    name: id || "Egyéb sport",
    cat: "Egyéb",
    icon: "fa-solid fa-stopwatch"
  };
}
