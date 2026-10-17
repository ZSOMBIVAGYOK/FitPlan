// ============================================================
// garmin-sports.js — Hivatalos Garmin Sportágak, Datafield-ek & Gyakorlattár
// FitPlan Pro | PR Hub, Edzés és Recovery modulhoz
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

// ── Hivatalos Garmin Connect Datafield-ek (Adatmezők) ────────
export const GARMIN_DATAFIELDS = [
  // Pulzus (Heart Rate)
  { id: "avg_hr", name: "Átlagos pulzus", cat: "Pulzus", unit: "bpm", placeholder: "148", icon: "fa-solid fa-heart-pulse" },
  { id: "max_hr", name: "Maximális pulzus", cat: "Pulzus", unit: "bpm", placeholder: "182", icon: "fa-solid fa-heart-pulse" },
  { id: "hr_zone", name: "Domináns pulzuszóna", cat: "Pulzus", unit: "Zóna", placeholder: "Zóna 2", icon: "fa-solid fa-chart-simple" },
  { id: "resting_hr", name: "Nyugalmi pulzus", cat: "Pulzus", unit: "bpm", placeholder: "52", icon: "fa-solid fa-bed" },

  // Tempó & Sebesség
  { id: "avg_pace", name: "Átlagos tempó", cat: "Tempó & Sebesség", unit: "perc/km", placeholder: "5:15", icon: "fa-solid fa-stopwatch" },
  { id: "best_pace", name: "Legjobb tempó", cat: "Tempó & Sebesség", unit: "perc/km", placeholder: "4:20", icon: "fa-solid fa-gauge-high" },
  { id: "avg_speed", name: "Átlagos sebesség", cat: "Tempó & Sebesség", unit: "km/h", placeholder: "28.5", icon: "fa-solid fa-gauge" },
  { id: "max_speed", name: "Maximális sebesség", cat: "Tempó & Sebesség", unit: "km/h", placeholder: "45.2", icon: "fa-solid fa-bolt" },

  // Távolság & Magasság
  { id: "distance", name: "Távolság", cat: "Távolság & Magasság", unit: "km", placeholder: "10.5", icon: "fa-solid fa-route" },
  { id: "elevation_gain", name: "Szintemelkedés", cat: "Távolság & Magasság", unit: "m", placeholder: "185", icon: "fa-solid fa-arrow-trend-up" },
  { id: "elevation_loss", name: "Szintvesztés", cat: "Távolság & Magasság", unit: "m", placeholder: "170", icon: "fa-solid fa-arrow-trend-down" },

  // Erő & Watt (Power)
  { id: "avg_power", name: "Átlagos teljesítmény (Watt)", cat: "Erő / Watt", unit: "W", placeholder: "240", icon: "fa-solid fa-bolt-lightning" },
  { id: "max_power", name: "Maximális teljesítmény", cat: "Erő / Watt", unit: "W", placeholder: "650", icon: "fa-solid fa-plug-circle-bolt" },
  { id: "normalized_power", name: "Normalizált teljesítmény (NP)", cat: "Erő / Watt", unit: "W", placeholder: "255", icon: "fa-solid fa-chart-line" },

  // Kadencia & Dinamika
  { id: "avg_cadence", name: "Átlagos lépésszám / pedálfordulat", cat: "Dinamika", unit: "spm / rpm", placeholder: "172", icon: "fa-solid fa-arrows-spin" },
  { id: "stride_length", name: "Átlagos lépéshossz", cat: "Dinamika", unit: "m", placeholder: "1.15", icon: "fa-solid fa-shoe-prints" },
  { id: "vertical_oscillation", name: "Vertikális kilengés", cat: "Dinamika", unit: "cm", placeholder: "8.2", icon: "fa-solid fa-arrows-up-down" },

  // Edzéshatás & Kondíció
  { id: "aerobic_te", name: "Aerob Edzéshatás (TE)", cat: "Edzéshatás", unit: "TE (0.0-5.0)", placeholder: "3.8", icon: "fa-solid fa-battery-half" },
  { id: "anaerobic_te", name: "Anaerob Edzéshatás (TE)", cat: "Edzéshatás", unit: "TE (0.0-5.0)", placeholder: "1.5", icon: "fa-solid fa-battery-bolt" },
  { id: "training_load", name: "Edzésterhelés (Load)", cat: "Edzéshatás", unit: "pt", placeholder: "142", icon: "fa-solid fa-fire" },
  { id: "calories", name: "Elégetett kalória", cat: "Edzéshatás", unit: "kcal", placeholder: "580", icon: "fa-solid fa-fire-flame-curved" },
  { id: "vo2max", name: "VO2 Max becslés", cat: "Edzéshatás", unit: "ml/kg/min", placeholder: "54", icon: "fa-solid fa-wind" },
  { id: "stamina_pct", name: "Hátramaradt Stamina", cat: "Edzéshatás", unit: "%", placeholder: "68", icon: "fa-solid fa-battery-three-quarters" },

  // Úszás specifikus
  { id: "avg_swolf", name: "Átlagos SWOLF", cat: "Úszás", unit: "pont", placeholder: "38", icon: "fa-solid fa-water" },
  { id: "stroke_rate", name: "Átlagos csapásszám", cat: "Úszás", unit: "csapás/perc", placeholder: "32", icon: "fa-solid fa-person-swimming" },
  { id: "pool_lengths", name: "Medencehosszok száma", cat: "Úszás", unit: "hossz", placeholder: "40", icon: "fa-solid fa-bars" },

  // Környezet
  { id: "temperature", name: "Hőmérséklet", cat: "Környezet", unit: "°C", placeholder: "18", icon: "fa-solid fa-temperature-half" }
];

export function getDatafieldById(id) {
  return GARMIN_DATAFIELDS.find(f => f.id === id) || {
    id: id || "custom",
    name: id || "Egyéni adatmező",
    cat: "Egyéb",
    unit: "",
    placeholder: "",
    icon: "fa-solid fa-chart-simple"
  };
}

// ── Beépített Gyakorlattár (Exercise Library) ────────────────
export const DEFAULT_EXERCISES = [
  // Erőnlét / Súlyzós
  { id: "bench_press", name: "Fekvenyomás rúddal", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Mell, Tricepsz" },
  { id: "incline_db_press", name: "Ferdepados nyomás kézisúllyal", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Felső mell" },
  { id: "overhead_press", name: "Vállból nyomás állva/ülve", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Váll, Deltoid" },
  { id: "squat", name: "Guggolás rúddal", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Comb, Gluteus" },
  { id: "front_squat", name: "Elölguggolás", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Négyfejű combizom" },
  { id: "deadlift", name: "Hagyományos felhúzás (Deadlift)", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Hát, Combhajlító" },
  { id: "romanian_deadlift", name: "Román felhúzás", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Combhajlító, Gluteus" },
  { id: "pull_up", name: "Húzódzkodás saját testsúllyal", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Széles hátizom, Bicepsz" },
  { id: "barbell_row", name: "Döntött törzsű evezés", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Közép- és felsőhát" },
  { id: "lat_pulldown", name: "Csigás lehúzás mellhez", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Széles hátizom" },
  { id: "barbell_curl", name: "Bicepsz hajlítás francia rúddal", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Bicepsz" },
  { id: "triceps_pushdown", name: "Tricepsz letolás csigán", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Tricepsz" },
  { id: "leg_press", name: "Lábtolás gépen", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Combok" },
  { id: "calf_raise", name: "Vádliemelés állva", sportId: "strength_training", category: "Erőnlét", targetMuscle: "Vádli" },

  // Kardió
  { id: "zone2_run", name: "Zóna 2 Alapozó Futás", sportId: "running", category: "Kardió", targetMuscle: "Szív, Aerob kapacitás" },
  { id: "tempo_run", name: "Tempófutás (Threshold)", sportId: "running", category: "Kardió", targetMuscle: "Laktátküszöb" },
  { id: "interval_sprint", name: "Intervallum sprint", sportId: "running", category: "Kardió", targetMuscle: "Anaerob kapacitás" },
  { id: "sweet_spot_cycling", name: "Sweet Spot Kerékpározás", sportId: "cycling", category: "Kardió", targetMuscle: "Lábak, Aerob" },
  { id: "interval_swimming", name: "Gyorsúszás intervallumok", sportId: "pool_swimming", category: "Kardió", targetMuscle: "Teljes test" },

  // Regeneráció / SMR / Nyújtás
  { id: "smr_it_band", name: "IT-szalag és Gluteus SMR hengerezés", sportId: "yoga", category: "SMR", targetMuscle: "Csípő, IT-szalag" },
  { id: "smr_quads", name: "Combfeszítő és Vádli hengerezés", sportId: "yoga", category: "SMR", targetMuscle: "Combok, Vádli" },
  { id: "smr_thoracic", name: "Háti gerinc extenzió hengeren", sportId: "yoga", category: "SMR", targetMuscle: "Háti gerinc mobilitás" },
  { id: "pigeon_pose", name: "Galambpóz csípőnyitó nyújtás", sportId: "yoga", category: "Nyújtás", targetMuscle: "Piriformis, Csípő" },
  { id: "hamstring_stretch", name: "Combhajlító mélynyújtás hevederrel", sportId: "yoga", category: "Nyújtás", targetMuscle: "Combhajlító" },
  { id: "cobra_pose", name: "Kobra póz és törzsnyújtás", sportId: "yoga", category: "Nyújtás", targetMuscle: "Hasizom, Gerinc" },
  { id: "sauna_contrast", name: "Finn szauna és hideg merülés", sportId: "yoga", category: "Hideg/Meleg", targetMuscle: "Idegrendszer, Vérkeringés" },
  { id: "box_breathing", name: "4-4-4-4 Box Breathing légzés", sportId: "breathwork", category: "Légzés", targetMuscle: "Paraszimpatikus idegrendszer" }
];
