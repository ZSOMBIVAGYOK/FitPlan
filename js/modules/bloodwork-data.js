// ============================================================
// bloodwork-data.js — Klinikai & Sportlabor Biomarker Adatbázis
// FitPlan Pro | WHOOP 5.0 Health & Longevity Elemző
// Fellelhető összes standard labor normálérték, mértékegységek,
// kategóriák és FitPlan Biológiai Életkor (Biological Age) kalkuláció.
// ============================================================

export const BLOODWORK_CATEGORIES = [
  { id: 'all',          name: 'Összes Biomarker', icon: 'fa-solid fa-dna' },
  { id: 'hematology',   name: 'Hematológia (Vérkép)', icon: 'fa-solid fa-droplet' },
  { id: 'metabolic',    name: 'Anyagcsere & Cukor', icon: 'fa-solid fa-cubes-stacked' },
  { id: 'lipids',       name: 'Lipid & Kardiovaszkuláris', icon: 'fa-solid fa-heart' },
  { id: 'inflammation', name: 'Gyulladás & Izomregeneráció', icon: 'fa-solid fa-fire-flame-curved' },
  { id: 'liver',        name: 'Májfunkció', icon: 'fa-solid fa-flask' },
  { id: 'kidney',       name: 'Vesefunkció & Elektrolitok', icon: 'fa-solid fa-filter' },
  { id: 'longevity',    name: 'Hormonok & Longevity', icon: 'fa-solid fa-hourglass-half' }
];

export const BLOODWORK_BIOMARKERS = [
  // ── 1. Hematológia (Teljes Vérkép / CBC) ───────────────────
  {
    id: 'wbc',
    name: 'Fehérvérsejt (WBC)',
    category: 'hematology',
    unit: 'G/L',
    min: 4.0,
    max: 10.0,
    optMin: 4.5,
    optMax: 7.5,
    defaultValue: 5.8,
    desc: 'Immunrendszer aktivitásának és gyulladásos folyamatoknak a fő jelzője.',
    longevityWeight: 0.15
  },
  {
    id: 'rbc',
    name: 'Vörösvértest (RBC)',
    category: 'hematology',
    unit: 'T/L',
    min: 4.3,
    max: 5.9,
    optMin: 4.5,
    optMax: 5.4,
    defaultValue: 4.95,
    desc: 'Oxigénszállító kapacitás alapja, kulcsfontosságú állóképességi sportoknál.',
    longevityWeight: 0.1
  },
  {
    id: 'hgb',
    name: 'Hemoglobin (Hgb)',
    category: 'hematology',
    unit: 'g/L',
    min: 135,
    max: 175,
    optMin: 145,
    optMax: 165,
    defaultValue: 154,
    desc: 'A vörösvértestek vasban gazdag oxigénkötő fehérjéje.',
    longevityWeight: 0.2
  },
  {
    id: 'hct',
    name: 'Hematokrit (Hct)',
    category: 'hematology',
    unit: 'L/L',
    min: 0.40,
    max: 0.52,
    optMin: 0.42,
    optMax: 0.48,
    defaultValue: 0.45,
    desc: 'Vérsejtek aránya a vérplazmához képest (viszkozitás és hidratáció).',
    longevityWeight: 0.1
  },
  {
    id: 'plt',
    name: 'Trombocita (PLT / Vérlemezke)',
    category: 'hematology',
    unit: 'G/L',
    min: 150,
    max: 400,
    optMin: 180,
    optMax: 300,
    defaultValue: 235,
    desc: 'Véralvadás és érfal-integritás szabályozója.',
    longevityWeight: 0.1
  },
  {
    id: 'mcv',
    name: 'Átlagos vvt térfogat (MCV)',
    category: 'hematology',
    unit: 'fL',
    min: 80,
    max: 98,
    optMin: 85,
    optMax: 94,
    defaultValue: 89,
    desc: 'Vörösvértestek átlagos mérete; B12/folsav és vashiány differenciálására.',
    longevityWeight: 0.05
  },

  // ── 2. Anyagcsere & Cukorháztartás ─────────────────────────
  {
    id: 'glucose',
    name: 'Éhgyomri Vércukor (Glukóz)',
    category: 'metabolic',
    unit: 'mmol/L',
    min: 3.9,
    max: 5.6,
    optMin: 4.1,
    optMax: 5.1,
    defaultValue: 4.8,
    desc: 'Alapvető glikémiás kontroll; magas szintje gyorsítja a glikációt és az öregedést.',
    longevityWeight: 0.4
  },
  {
    id: 'hba1c',
    name: 'HbA1c (Glikált Hemoglobin)',
    category: 'metabolic',
    unit: '%',
    min: 4.0,
    max: 5.6,
    optMin: 4.6,
    optMax: 5.2,
    defaultValue: 5.0,
    desc: 'Az elmúlt 90 nap átlagos vércukorszintjének legpontosabb lenyomata.',
    longevityWeight: 0.45
  },
  {
    id: 'insulin',
    name: 'Éhomi Inzulin',
    category: 'metabolic',
    unit: 'µIU/mL',
    min: 2.0,
    max: 20.0,
    optMin: 2.5,
    optMax: 6.5,
    defaultValue: 4.2,
    desc: 'Inzulinérzékenység és anyagcsere-rugalmasság fő mutatója.',
    longevityWeight: 0.35
  },
  {
    id: 'homa_ir',
    name: 'HOMA-IR Index',
    category: 'metabolic',
    unit: 'index',
    min: 0.0,
    max: 2.0,
    optMin: 0.5,
    optMax: 1.4,
    defaultValue: 0.9,
    desc: 'Inzulinrezisztencia kalkulált mutatója (< 1.4 kiváló inzulinérzékenység).',
    longevityWeight: 0.35
  },

  // ── 3. Lipid Profil & Kardiovaszkuláris ───────────────────
  {
    id: 'cholesterol_total',
    name: 'Összkoleszterin',
    category: 'lipids',
    unit: 'mmol/L',
    min: 3.5,
    max: 5.2,
    optMin: 4.0,
    optMax: 5.0,
    defaultValue: 4.6,
    desc: 'Összes keringő koleszterin szintje a szervezetben.',
    longevityWeight: 0.2
  },
  {
    id: 'hdl',
    name: 'HDL ("Védő" Koleszterin)',
    category: 'lipids',
    unit: 'mmol/L',
    min: 1.2,
    max: 2.6,
    optMin: 1.45,
    optMax: 2.2,
    defaultValue: 1.72,
    desc: 'Érfalakat tisztító reverz koleszterintranszport; magas értéke védi az ereket.',
    longevityWeight: 0.35
  },
  {
    id: 'ldl',
    name: 'LDL Koleszterin',
    category: 'lipids',
    unit: 'mmol/L',
    min: 1.8,
    max: 3.0,
    optMin: 1.8,
    optMax: 2.6,
    defaultValue: 2.35,
    desc: 'Aterogén koleszterin frakció; érelmeszesedés kockázati tényezője.',
    longevityWeight: 0.3
  },
  {
    id: 'triglycerides',
    name: 'Triglicerid',
    category: 'lipids',
    unit: 'mmol/L',
    min: 0.5,
    max: 1.7,
    optMin: 0.6,
    optMax: 1.1,
    defaultValue: 0.85,
    desc: 'Keringő vérzsírok; alacsony szintje tiszta, rugalmas anyagcserét jelez.',
    longevityWeight: 0.3
  },
  {
    id: 'apob',
    name: 'Apolipoprotein B (ApoB)',
    category: 'lipids',
    unit: 'g/L',
    min: 0.6,
    max: 1.0,
    optMin: 0.6,
    optMax: 0.8,
    defaultValue: 0.72,
    desc: 'Aterogén részecskék darabszámának legmodernebb mutatója a kardiológiában.',
    longevityWeight: 0.35
  },

  // ── 4. Gyulladás & Izomregeneráció ─────────────────────────
  {
    id: 'hscrp',
    name: 'Nagy érzékenységű hs-CRP',
    category: 'inflammation',
    unit: 'mg/L',
    min: 0.0,
    max: 1.0,
    optMin: 0.05,
    optMax: 0.5,
    defaultValue: 0.28,
    desc: 'Szisztémás mikroszkopikus gyulladás; a hosszú élettartam és érrendszer arany standardja.',
    longevityWeight: 0.5
  },
  {
    id: 'esr',
    name: 'Vörösvértest Süllyedés (We)',
    category: 'inflammation',
    unit: 'mm/h',
    min: 2,
    max: 15,
    optMin: 2,
    optMax: 8,
    defaultValue: 4,
    desc: 'Klasszikus gyulladásos és fehérje-egyensúlyi laborparaméter.',
    longevityWeight: 0.15
  },
  {
    id: 'ck',
    name: 'Kreatin-kináz (CK)',
    category: 'inflammation',
    unit: 'U/L',
    min: 40,
    max: 200,
    optMin: 60,
    optMax: 170,
    defaultValue: 112,
    desc: 'Izomsérülés és mikrotrauma enzime; edzés utáni izomregeneráció követésére.',
    longevityWeight: 0.15
  },
  {
    id: 'homocysteine',
    name: 'Homocisztein',
    category: 'inflammation',
    unit: 'µmol/L',
    min: 5.0,
    max: 12.0,
    optMin: 5.5,
    optMax: 9.0,
    defaultValue: 7.4,
    desc: 'Metilációs ciklus és érfal-oxidáció jelzője (< 9.0 optimális kardiovaszkuláris védelem).',
    longevityWeight: 0.25
  },

  // ── 5. Májfunkció & Enzimek ────────────────────────────────
  {
    id: 'got_ast',
    name: 'GOT / AST Enzim',
    category: 'liver',
    unit: 'U/L',
    min: 10,
    max: 40,
    optMin: 15,
    optMax: 30,
    defaultValue: 22,
    desc: 'Májsejtek és izomsejtek intracelluláris enzime.',
    longevityWeight: 0.15
  },
  {
    id: 'gpt_alt',
    name: 'GPT / ALT Enzim',
    category: 'liver',
    unit: 'U/L',
    min: 10,
    max: 45,
    optMin: 12,
    optMax: 32,
    defaultValue: 24,
    desc: 'Máj-specifikus enzim; zsírmáj és toxinterhelés érzékeny detektora.',
    longevityWeight: 0.2
  },
  {
    id: 'ggt',
    name: 'GGT Enzim',
    category: 'liver',
    unit: 'U/L',
    min: 10,
    max: 55,
    optMin: 12,
    optMax: 28,
    defaultValue: 18,
    desc: 'Epeutak és glutation-anyagcsere állapota; oxidatív stressz jelzője.',
    longevityWeight: 0.25
  },
  {
    id: 'bilirubin_total',
    name: 'Össz-Bilirubin',
    category: 'liver',
    unit: 'µmol/L',
    min: 5.0,
    max: 21.0,
    optMin: 8.0,
    optMax: 18.0,
    defaultValue: 13.5,
    desc: 'Hemoglobin lebomlási terméke; enyhén magasabb szintje erős endogén antioxidáns hatású.',
    longevityWeight: 0.1
  },

  // ── 6. Vesefunkció & Elektrolitok ─────────────────────────
  {
    id: 'creatinine',
    name: 'Kreatinin',
    category: 'kidney',
    unit: 'µmol/L',
    min: 62,
    max: 106,
    optMin: 70,
    optMax: 95,
    defaultValue: 84,
    desc: 'Izomtömeg és veseszűrés arányának mérőszáma.',
    longevityWeight: 0.15
  },
  {
    id: 'egfr',
    name: 'eGFR (Szűrési Sebesség)',
    category: 'kidney',
    unit: 'mL/min',
    min: 90,
    max: 140,
    optMin: 95,
    optMax: 130,
    defaultValue: 112,
    desc: 'Glomeruláris filtrációs ráta; a vesék funkcionális kapacitása (> 90 ideális).',
    longevityWeight: 0.3
  },
  {
    id: 'uric_acid',
    name: 'Húgysav',
    category: 'kidney',
    unit: 'µmol/L',
    min: 200,
    max: 420,
    optMin: 220,
    optMax: 340,
    defaultValue: 275,
    desc: 'Purin-anyagcsere és fruktózterhelés végterméke; magas szintje érfalgyulladást okoz.',
    longevityWeight: 0.25
  },
  {
    id: 'magnesium',
    name: 'Szérum Magnézium',
    category: 'kidney',
    unit: 'mmol/L',
    min: 0.75,
    max: 1.05,
    optMin: 0.85,
    optMax: 1.02,
    defaultValue: 0.94,
    desc: 'Több mint 300 enzim kofaktora; izomgörcsök és szívritmus megelőzője.',
    longevityWeight: 0.2
  },

  // ── 7. Hormonok & Longevity ────────────────────────────────
  {
    id: 'ferritin',
    name: 'Ferritin (Vasraktár)',
    category: 'longevity',
    unit: 'µg/L',
    min: 30,
    max: 300,
    optMin: 60,
    optMax: 150,
    defaultValue: 98,
    desc: 'Szervezet tényleges vasraktára; fáradtság és sejtenergia (ATP) alappillére.',
    longevityWeight: 0.3
  },
  {
    id: 'vitamin_d',
    name: 'D3-vitamin (25-OH-D)',
    category: 'longevity',
    unit: 'nmol/L',
    min: 75,
    max: 175,
    optMin: 100,
    optMax: 150,
    defaultValue: 124,
    desc: 'Génexpressziót és immunrendszert vezérlő szteroid prekurzor hormon.',
    longevityWeight: 0.4
  },
  {
    id: 'testosterone',
    name: 'Totál Tesztoszteron',
    category: 'longevity',
    unit: 'nmol/L',
    min: 10.0,
    max: 30.0,
    optMin: 18.0,
    optMax: 28.0,
    defaultValue: 23.4,
    desc: 'Anabolikus felépítés, energiaszint, izomtömeg és libidó motorja.',
    longevityWeight: 0.3
  },
  {
    id: 'tsh',
    name: 'TSH (Pajzsmirigy)',
    category: 'longevity',
    unit: 'mIU/L',
    min: 0.4,
    max: 4.0,
    optMin: 1.0,
    optMax: 2.5,
    defaultValue: 1.65,
    desc: 'Alapanyagcsere-sebesség és termogenezis legfőbb szabályozója.',
    longevityWeight: 0.25
  }
];

// ── Értékelő és Állapot Kiszámító Függvény ──────────────────
export function evaluateBiomarker(biomarker, value) {
  const val = Number(value);
  if (isNaN(val)) return { status: 'unknown', text: 'Nincs adat', color: '#9ca3af' };

  if (val >= biomarker.optMin && val <= biomarker.optMax) {
    return {
      status: 'optimal',
      text: 'Optimális (Longevity Zone)',
      badgeClass: 'bg-emerald-500/10 text-[#00E676] border-emerald-500/30',
      color: '#00E676',
      score: 1.0
    };
  }

  if (val >= biomarker.min && val <= biomarker.max) {
    return {
      status: 'normal',
      text: 'Normál tartomány',
      badgeClass: 'bg-amber-500/10 text-[#FFD600] border-amber-500/30',
      color: '#FFD600',
      score: 0.7
    };
  }

  return {
    status: 'risk',
    text: val < biomarker.min ? 'Alacsony (Referencia alatt)' : 'Emelkedett (Referencia felett)',
    badgeClass: 'bg-red-500/10 text-[#FF3D00] border-red-500/30',
    color: '#FF3D00',
    score: 0.2
  };
}

// ── Teljes Vérkép Pontszám & Életkor Eltérés ────────────────
export function calcBloodworkScore(userValues = {}) {
  let totalScore = 0;
  let totalWeight = 0;
  let optimalCount = 0;
  let normalCount = 0;
  let riskCount = 0;
  let ageDelta = 0;

  BLOODWORK_BIOMARKERS.forEach(bm => {
    const val = userValues[bm.id] !== undefined ? Number(userValues[bm.id]) : bm.defaultValue;
    const evaluation = evaluateBiomarker(bm, val);
    const weight = bm.longevityWeight || 0.2;

    totalScore += evaluation.score * weight;
    totalWeight += weight;

    if (evaluation.status === 'optimal') optimalCount++;
    else if (evaluation.status === 'normal') normalCount++;
    else riskCount++;

    // Életkor hatás (Optimalis érték fiatalít, kockázati öregít)
    if (evaluation.status === 'optimal') {
      ageDelta -= weight * 0.45;
    } else if (evaluation.status === 'risk') {
      ageDelta += weight * 1.2;
    }
  });

  const percentage = Math.round((totalScore / (totalWeight || 1)) * 100);

  return {
    scorePct: Math.min(100, Math.max(0, percentage)),
    optimalCount,
    normalCount,
    riskCount,
    totalCount: BLOODWORK_BIOMARKERS.length,
    bloodAgeDelta: Math.round(ageDelta * 10) / 10
  };
}

// ── FitPlan Biológiai Életkor (Biological Age) Motor ─────────
export function calcFitPlanAge(chronoAge = 28, whoopData = {}, bloodworkValues = {}) {
  const age = Math.max(18, Number(chronoAge) || 28);

  const rhr = Number(whoopData.rhr) || 48;
  const hrv = Number(whoopData.hrv) || 78;
  const rec = Number(whoopData.recovery) || 78;
  const strain = Number(whoopData.strain) || 14.2;
  const sleepEff = Number(whoopData.sleepEfficiency) || 94;

  // 1. Szív-érrendszeri hatás (RHR & HRV)
  // RHR: 60 felett öregít, 60 alatt fiatalít
  const rhrDelta = (rhr - 60) * 0.22;
  // HRV: 50 alatt öregít, 50 felett fiatalít
  const hrvDelta = -(hrv - 50) * 0.08;

  // 2. Alvási hatékonyság & Sejtregeneráció
  const sleepDelta = (88 - sleepEff) * 0.12;

  // 3. Edzésterhelés & Recovery szinergia
  const strainDelta = strain >= 10.0 ? -1.0 : 0.5;
  const recDelta = (70 - rec) * 0.04;

  // 4. Vérkép biomarker hatás
  const bloodResult = calcBloodworkScore(bloodworkValues);
  const bloodDelta = bloodResult.bloodAgeDelta;

  const totalDelta = rhrDelta + hrvDelta + sleepDelta + strainDelta + recDelta + bloodDelta;
  const biologicalAge = Math.max(18.0, Math.round((age + totalDelta) * 10) / 10);
  const diff = Math.round((biologicalAge - age) * 10) / 10;
  const paceOfAging = Math.max(0.65, Math.min(1.45, Math.round((biologicalAge / age) * 100) / 100));

  return {
    chronoAge: age,
    biologicalAge,
    diff, // negatív = fiatalabb, pozitív = öregebb
    paceOfAging,
    bloodResult,
    breakdown: {
      cardio: Math.round((rhrDelta + hrvDelta) * 10) / 10,
      sleep: Math.round(sleepDelta * 10) / 10,
      training: Math.round((strainDelta + recDelta) * 10) / 10,
      blood: bloodDelta
    }
  };
}

export const calcLockinAge = calcFitPlanAge;

