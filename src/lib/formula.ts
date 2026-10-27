/** Fórmulas simples para métricas personalizadas: + - * / ( ) números y códigos de métricas base. */
export type Token = { t: "num"; v: number } | { t: "id"; v: string } | { t: "op"; v: string } | { t: "(" } | { t: ")" };

export function tokenizar(f: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < f.length) {
    const c = f[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i; while (j < f.length && /[0-9.]/.test(f[j])) j++;
      const n = Number(f.slice(i, j));
      if (Number.isNaN(n)) throw new Error(`Número inválido: ${f.slice(i, j)}`);
      out.push({ t: "num", v: n }); i = j; continue;
    }
    if (/[a-z_]/i.test(c)) {
      let j = i; while (j < f.length && /[a-z0-9_]/i.test(f[j])) j++;
      out.push({ t: "id", v: f.slice(i, j).toLowerCase() }); i = j; continue;
    }
    if ("+-*/×÷".includes(c)) { out.push({ t: "op", v: c === "×" ? "*" : c === "÷" ? "/" : c }); i++; continue; }
    if (c === "(") { out.push({ t: "(" }); i++; continue; }
    if (c === ")") { out.push({ t: ")" }); i++; continue; }
    throw new Error(`Carácter no permitido: «${c}»`);
  }
  return out;
}

const PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "~": 3 };

export function aRpn(tokens: Token[]): Token[] {
  const out: Token[] = []; const ops: Token[] = [];
  let prev: Token | null = null;
  for (const tk of tokens) {
    if (tk.t === "num" || tk.t === "id") out.push(tk);
    else if (tk.t === "op") {
      const unario = tk.v === "-" && (!prev || prev.t === "op" || prev.t === "(");
      const op: Token = { t: "op", v: unario ? "~" : tk.v };
      while (ops.length) {
        const top = ops[ops.length - 1];
        if (top.t === "op" && op.v !== "~" && PREC[top.v] >= PREC[op.v]) out.push(ops.pop()!); else break;
      }
      ops.push(op);
    } else if (tk.t === "(") ops.push(tk);
    else {
      while (ops.length && ops[ops.length - 1].t !== "(") out.push(ops.pop()!);
      if (!ops.length) throw new Error("Paréntesis sin abrir");
      ops.pop();
    }
    prev = tk;
  }
  while (ops.length) { const o = ops.pop()!; if (o.t === "(") throw new Error("Paréntesis sin cerrar"); out.push(o); }
  return out;
}

export function variables(formula: string): string[] {
  return [...new Set(tokenizar(formula).filter((t): t is { t: "id"; v: string } => t.t === "id").map((t) => t.v))];
}

export function evaluar(formula: string, vars: Record<string, number | null>): number | null {
  const rpn = aRpn(tokenizar(formula));
  const st: (number | null)[] = [];
  for (const tk of rpn) {
    if (tk.t === "num") st.push(tk.v);
    else if (tk.t === "id") {
      if (!(tk.v in vars)) throw new Error(`Métrica desconocida: ${tk.v}`);
      st.push(vars[tk.v]);
    } else if (tk.t === "op") {
      if (tk.v === "~") { const a = st.pop(); if (a === undefined) throw new Error("Fórmula incompleta"); st.push(a === null ? null : -a); continue; }
      const b = st.pop(); const a = st.pop();
      if (a === undefined || b === undefined) throw new Error("Fórmula incompleta");
      if (a === null || b === null) { st.push(null); continue; }
      if (tk.v === "+") st.push(a + b);
      else if (tk.v === "-") st.push(a - b);
      else if (tk.v === "*") st.push(a * b);
      else st.push(b === 0 ? null : a / b);
    }
  }
  if (st.length !== 1) throw new Error("Fórmula incompleta");
  const r = st[0];
  return r === null || !Number.isFinite(r) ? null : r;
}

/** Valida sintaxis y variables permitidas; devuelve las variables usadas. */
export function validarFormula(formula: string, permitidas: string[]): string[] {
  const vs = variables(formula);
  for (const v of vs) if (!permitidas.includes(v)) throw new Error(`«${v}» no es una métrica base. Usa: ${permitidas.join(", ")}`);
  evaluar(formula, Object.fromEntries(permitidas.map((p) => [p, 1])));
  return vs;
}
