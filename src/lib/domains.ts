export const COMPARISON_DOMAINS = [
  "finpension.ch", "moneyland.ch", "comparis.ch", "vermoegens-partner.ch",
  "schwiizerfranke.ch", "evaluno.ch", "financescout24.ch", "moneypark.ch",
  "hypotheke.ch", "kredite.ch", "toppreise.ch", "vermoegenszentrum.ch",
  "123-pensionierung.ch", "kassentest.ch", "vorsorge-experten.ch",
];

export function isComparisonUrl(url: string): boolean {
  return COMPARISON_DOMAINS.some((d) => url.toLowerCase().includes(d));
}
