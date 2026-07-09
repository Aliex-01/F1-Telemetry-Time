// Orden compartido de la parrilla de coches (directo y repeticion).
//
// Ordena por EQUIPOS de forma estable (no salta con la velocidad):
//   1. Equipos por suma de posiciones de sus pilotos (menor suma, primero).
//   2. Empate -> equipo con el piloto mejor clasificado (posicion mas baja).
//   3. Empate -> equipo con el numero de piloto mas bajo.
// Dentro de cada equipo, primero el companero mejor clasificado.
//
// La parrilla se pinta en 2 filas (ver `gridTemplateColumns` en las vistas: una
// columna por equipo). Para que cada equipo quede en su columna con el mejor
// arriba y el peor abajo, devolvemos el orden por COLUMNAS: primero el mejor de
// cada equipo (fila de arriba, en orden de equipos) y luego el peor (fila de abajo).
// Ej.: equipos [B,A] [C,D] [F,E] -> B C F / A D E.

export const NO_POS = 99; // piloto sin posicion conocida: va al final

export function orderByTeam<T>(
  entries: [string, T][],
  posOf: (num: string) => number,
  teamOf: (num: string) => string | null,
  numberOf: (num: string) => number,
): [string, T][] {
  const teams = new Map<string, [string, T][]>();
  for (const e of entries) {
    const key = teamOf(e[0]) ?? `solo:${e[0]}`;
    (teams.get(key) ?? teams.set(key, []).get(key)!).push(e);
  }

  const sortedTeams = [...teams.values()]
    .map((members) => {
      members.sort((a, b) => posOf(a[0]) - posOf(b[0]) || numberOf(a[0]) - numberOf(b[0]));
      const positions = members.map(([num]) => posOf(num));
      return {
        members,
        sum: positions.reduce((s, p) => s + p, 0),
        best: Math.min(...positions),
        minNum: Math.min(...members.map(([num]) => numberOf(num))),
      };
    })
    .sort((a, b) => a.sum - b.sum || a.best - b.best || a.minNum - b.minNum)
    .map((t) => t.members);

  // Volcado por columnas: fila 0 = mejor de cada equipo, fila 1 = peor, etc.
  const maxLen = sortedTeams.reduce((m, t) => Math.max(m, t.length), 0);
  const ordered: [string, T][] = [];
  for (let row = 0; row < maxLen; row++) {
    for (const members of sortedTeams) {
      if (members[row]) ordered.push(members[row]);
    }
  }

  return ordered;
}
