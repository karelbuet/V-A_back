/**
 * Vérifie que toutes les clés du tableau sont présentes et non vides dans l'objet body.
 * Supporte string, number et boolean.
 * @param {Object} body - L'objet à vérifier.
 * @param {Array<string>} keys - Les clés à vérifier.
 * @returns {boolean} true si toutes les clés sont valides, false sinon.
 */
export function checkBody(body, keys) {
  if (typeof body !== "object" || body === null) return false;

  return keys.every((field) => {
    if (!(field in body)) return false;

    const value = body[field];

    if (value === null || value === undefined) return false;

    if (typeof value === "string") {
      return value.trim() !== "";
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return true; // ces types sont considérés comme valides
    }

    // Si c'est un objet ou tableau, vérifie qu'il n'est pas vide
    if (typeof value === "object") {
      return Object.keys(value).length > 0;
    }

    return false; // types non supportés
  });
}
