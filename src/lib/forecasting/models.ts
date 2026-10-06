import { normalCdf } from "../math";
import type { Learner, ModelSpec } from "./types";

/** Every model mixes a little uniform mass in so no class ever gets probability 0 (log-loss stays finite). */
const MIX = 1e-3;

function finalize(raw: number[], K: number, mix = MIX): number[] {
  let s = 0;
  for (const x of raw) s += x;
  if (!(s > 0) || !Number.isFinite(s)) return new Array<number>(K).fill(1 / K);
  return raw.map((x) => (1 - mix) * (x / s) + mix / K);
}

const uniform = (K: number): number[] => new Array<number>(K).fill(1 / K);

function countsOf(h: readonly number[], K: number, alpha: number): number[] {
  const c = new Array<number>(K).fill(alpha);
  for (const v of h) c[v]++;
  return c;
}

const stateless = (predict: (h: readonly number[], rng: () => number) => number[]): Learner => ({
  fit() {},
  predict,
});

// ---- 1. Uniform random baseline -------------------------------------------------------------
const uniformSpec: ModelSpec = {
  id: "uniform",
  name: "สุ่มสม่ำเสมอ (Random baseline)",
  family: "baseline",
  description: "ให้ความน่าจะเป็นเท่ากันทุกค่า (1/K) — ใช้เป็นเกณฑ์เปรียบเทียบ",
  limitations: "เป็นเกณฑ์อ้างอิงเท่านั้น ไม่ใช่โมเดลที่เรียนรู้จากข้อมูล",
  minTrain: () => 0,
  create: (K) => stateless(() => uniform(K)),
};

// ---- 2. Frequency (expanding) ---------------------------------------------------------------
const frequencySpec: ModelSpec = {
  id: "frequency",
  name: "ความถี่สะสม (Frequency baseline)",
  family: "frequency",
  description: "ความน่าจะเป็นตามความถี่ที่เคยเกิดในอดีตทั้งหมด (Laplace smoothing α=1)",
  limitations: "สมมติว่าการแจกแจงคงที่และงวดไม่ขึ้นต่อกัน; ถ้าผลเป็นสุ่มสม่ำเสมอ ความถี่ที่ต่างกันเป็นเพียงความผันผวนของตัวอย่าง",
  minTrain: () => 10,
  create: (K) => stateless((h) => finalize(countsOf(h, K, 1), K)),
};

// ---- 3. Rolling-window frequency -----------------------------------------------------------
const rollingFrequencySpec: ModelSpec = {
  id: "rolling_frequency",
  name: "ความถี่หน้าต่างเลื่อน (Rolling frequency, W=20)",
  family: "frequency",
  description: "ใช้ความถี่ของ 20 งวดล่าสุดเท่านั้น (Laplace smoothing α=1)",
  limitations: "ตัวอย่างน้อยมาก (20 งวด) จึงมีความแปรปรวนสูง โดยเฉพาะเป้าหมายที่มีหลายคลาส",
  minTrain: () => 10,
  create: (K) => stateless((h) => finalize(countsOf(h.slice(Math.max(0, h.length - 20)), K, 1), K)),
};

// ---- 4. Moving average (EWMA of one-hot) ----------------------------------------------------
const movingAverageSpec: ModelSpec = {
  id: "moving_average",
  name: "ค่าเฉลี่ยเคลื่อนที่แบบถ่วงน้ำหนัก (EWMA, W≈10)",
  family: "smoothing",
  description: "ถัวเฉลี่ยแบบเอ็กซ์โปเนนเชียลของตัวชี้วัด one-hot (น้ำหนักงวดล่าสุดมากกว่า) บวกค่า pseudo-count α=0.5 ต่อคลาส",
  limitations: "ให้น้ำหนักงวดล่าสุดมาก จึงไวต่อสัญญาณรบกวน; ไม่มีกลไกที่เชื่อมโยงกับกระบวนการออกรางวัลจริง",
  minTrain: () => 10,
  create: (K) => {
    const lambda = 2 / (10 + 1);
    return stateless((h) => {
      // exponentially weighted counts (weights sum to ≈ 1/λ) + additive smoothing
      const s = new Array<number>(K).fill(0);
      for (const v of h) {
        for (let k = 0; k < K; k++) s[k] *= 1 - lambda;
        s[v] += 1;
      }
      return finalize(s.map((x) => x + 0.5), K);
    });
  },
};

// ---- 5. Markov order-1 ----------------------------------------------------------------------
const markovSpec: ModelSpec = {
  id: "markov1",
  name: "มาร์คอฟอันดับ 1 (Markov chain)",
  family: "markov",
  description: "ความน่าจะเป็นของค่าถัดไปขึ้นกับค่าก่อนหน้า (ตารางการเปลี่ยนสถานะ, smoothing เข้าหาความถี่รวม β=5)",
  limitations: "ตารางเปลี่ยนสถานะมี K×K ช่อง ข้อมูลต่อช่องจึงน้อยมาก (โดยเฉพาะ K=100) ทำให้ประมาณค่าไม่เสถียร",
  minTrain: () => 20,
  create: (K) =>
    stateless((h) => {
      if (h.length === 0) return uniform(K);
      const beta = 5;
      const q = countsOf(h, K, 1);
      const qs = q.reduce((a, b) => a + b, 0);
      const last = h[h.length - 1];
      const row = new Array<number>(K).fill(0);
      let n = 0;
      for (let i = 1; i < h.length; i++) {
        if (h[i - 1] === last) {
          row[h[i]]++;
          n++;
        }
      }
      return finalize(row.map((c, k) => (c + (beta * q[k]) / qs) / (n + beta)), K);
    }),
};

// ---- 6. Time-series: AR(p) with discretised Gaussian ---------------------------------------
class ArLearner implements Learner {
  private beta: number[] | null = null;
  private sigma = 1;
  constructor(
    private readonly K: number,
    private readonly p: number,
  ) {}

  fit(train: readonly number[]): void {
    const { p } = this;
    const rows: number[][] = [];
    const ys: number[] = [];
    for (let i = p; i < train.length; i++) {
      rows.push([1, ...Array.from({ length: p }, (_, j) => train[i - 1 - j])]);
      ys.push(train[i]);
    }
    if (rows.length < p + 5) {
      this.beta = null;
      return;
    }
    const d = p + 1;
    // Normal equations with a tiny ridge for numerical safety.
    const A = Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => rows.reduce((s, r) => s + r[a] * r[b], 0) + (a === b ? 1e-6 : 0)));
    const b = Array.from({ length: d }, (_, a) => rows.reduce((s, r, i) => s + r[a] * ys[i], 0));
    const beta = solve(A, b);
    if (!beta) {
      this.beta = null;
      return;
    }
    let rss = 0;
    rows.forEach((r, i) => {
      const pred = r.reduce((s, x, j) => s + x * beta[j], 0);
      rss += (ys[i] - pred) ** 2;
    });
    this.beta = beta;
    this.sigma = Math.max(0.5, Math.sqrt(rss / Math.max(1, rows.length - d)));
  }

  predict(history: readonly number[]): number[] {
    const { K, p } = this;
    if (!this.beta || history.length < p) return uniform(K);
    let mu = this.beta[0];
    for (let j = 0; j < p; j++) mu += this.beta[1 + j] * history[history.length - 1 - j];
    const raw = new Array<number>(K);
    for (let k = 0; k < K; k++) {
      const lo = k === 0 ? 0 : normalCdf((k - 0.5 - mu) / this.sigma);
      const hi = k === K - 1 ? 1 : normalCdf((k + 0.5 - mu) / this.sigma);
      raw[k] = Math.max(0, hi - lo);
    }
    return finalize(raw, K, 0.02);
  }
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-12) return null;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let k = r + 1; k < n; k++) s -= M[r][k] * x[k];
    x[r] = s / M[r][r];
  }
  return x;
}

const arSpec: ModelSpec = {
  id: "autoregressive",
  name: "อนุกรมเวลา AR(2)",
  family: "time-series",
  description: "ถดถอยค่าปัจจุบันบน 2 งวดก่อนหน้า (OLS) แล้วแปลงเป็นการแจกแจงแบบเกาส์เซียนที่ปัดเป็นช่วง",
  limitations: "ตัวเลขรางวัลเป็นค่ากลุ่ม (categorical) การตีความเป็นปริมาณต่อเนื่องไม่มีเหตุผลเชิงกายภาพ; ถ้าข้อมูลสม่ำเสมอ การแจกแจงเกาส์เซียนจะ “แคบเกินจริง” และทำให้ log-loss แย่กว่าสุ่ม",
  minTrain: () => 30,
  create: (K) => new ArLearner(K, 2),
};

// ---- 7. Monte Carlo (bootstrap simulation) -------------------------------------------------
const monteCarloSpec: ModelSpec = {
  id: "monte_carlo",
  name: "Monte Carlo (bootstrap 1,000 รอบ)",
  family: "simulation",
  description: "สุ่มจำลองงวดถัดไปโดย resample จากประวัติที่ผ่านมา + 1 ตัวอย่างเทียมต่อคลาส (smoothed bootstrap, seed คงที่) แล้วนับสัดส่วนผลจำลอง",
  limitations: "เทียบเท่าโมเดลความถี่ที่มีสัญญาณรบกวนจากการสุ่มจำลองเพิ่ม จึงไม่น่าจะดีกว่าโมเดลความถี่",
  minTrain: () => 10,
  create: (K) =>
    stateless((h, rng) => {
      if (h.length === 0) return uniform(K);
      const S = 1000;
      const c = new Array<number>(K).fill(0);
      const pool = h.length + K; // history + one pseudo-observation per class
      for (let s = 0; s < S; s++) {
        const u = Math.floor(rng() * pool);
        c[u < h.length ? h[u] : u - h.length]++;
      }
      return finalize(c.map((x) => x + 0.5), K);
    }),
};

// ---- 8. Machine learning: softmax regression on lag features ------------------------------
class SoftmaxLearner implements Learner {
  private W: number[][] | null = null; // [K][1 + 2K]
  constructor(private readonly K: number) {}

  private logits(a: number, b: number): number[] {
    const { K } = this;
    const W = this.W as number[][];
    return W.map((w) => w[0] + w[1 + a] + w[1 + K + b]);
  }

  fit(train: readonly number[]): void {
    const { K } = this;
    const N = train.length - 2;
    if (N < 10) {
      this.W = null;
      return;
    }
    const dim = 1 + 2 * K;
    const W = Array.from({ length: K }, () => new Array<number>(dim).fill(0));
    this.W = W;
    const lr = 0.5;
    const l2 = 0.05;
    for (let it = 0; it < 150; it++) {
      const grad = Array.from({ length: K }, () => new Array<number>(dim).fill(0));
      for (let i = 2; i < train.length; i++) {
        const a = train[i - 1];
        const b = train[i - 2];
        const z = this.logits(a, b);
        const m = Math.max(...z);
        let s = 0;
        const e = z.map((v) => {
          const x = Math.exp(v - m);
          s += x;
          return x;
        });
        for (let k = 0; k < K; k++) {
          const err = e[k] / s - (train[i] === k ? 1 : 0);
          grad[k][0] += err;
          grad[k][1 + a] += err;
          grad[k][1 + K + b] += err;
        }
      }
      for (let k = 0; k < K; k++) {
        for (let j = 0; j < dim; j++) W[k][j] -= lr * (grad[k][j] / N + (j === 0 ? 0 : l2 * W[k][j]));
      }
    }
  }

  predict(history: readonly number[]): number[] {
    const { K } = this;
    if (!this.W || history.length < 2) return uniform(K);
    const z = this.logits(history[history.length - 1], history[history.length - 2]);
    const m = Math.max(...z);
    return finalize(z.map((v) => Math.exp(v - m)), K, 0.02);
  }
}

const softmaxSpec: ModelSpec = {
  id: "softmax_ml",
  name: "Machine Learning: Softmax regression (lag 1–2)",
  family: "machine-learning",
  description: "ถดถอยโลจิสติกพหุนามจาก 2 งวดก่อนหน้า (one-hot) พร้อม L2 regularization; ทำงานเมื่อมีข้อมูลฝึกอย่างน้อย max(100, 10×K) งวด",
  limitations: "พารามิเตอร์ต่อคลาสมาก แต่ข้อมูลมีน้อย จึงมีความเสี่ยง overfit สูง; เมื่อข้อมูลไม่พอระบบจะรายงาน “ข้อมูลไม่เพียงพอ” แทนการประเมินที่ไม่น่าเชื่อถือ",
  minTrain: (K) => Math.max(100, 10 * K),
  create: (K) => new SoftmaxLearner(K),
};

export const MODEL_SPECS: ModelSpec[] = [
  uniformSpec,
  frequencySpec,
  rollingFrequencySpec,
  movingAverageSpec,
  markovSpec,
  arSpec,
  monteCarloSpec,
  softmaxSpec,
];

export function getModelSpec(id: string): ModelSpec | undefined {
  return MODEL_SPECS.find((m) => m.id === id);
}
