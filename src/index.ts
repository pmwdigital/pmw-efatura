export interface XmlParser {
    parseFromString(source: string, mimeType: "application/xml"): XmlDocument;
}

interface XmlDocument {
    readonly documentElement: XmlElement | null;
    getElementsByTagName(qualifiedName: string): ArrayLike<unknown>;
    getElementsByTagNameNS(namespace: string, localName: string): ArrayLike<XmlElement>;
}

interface XmlElement {
    readonly localName: string | null;
    readonly children: ArrayLike<XmlElement>;
    readonly textContent: string | null;
    getAttribute(qualifiedName: string): string | null;
}

export interface Party {
    name: string | null;
    taxId: string | null;
    taxOffice: string | null;
}

export interface Discount {
    rate: number | null;
    amount: number;
    invoiceShare?: true;
}

export interface InvoiceLine {
    name: string;
    code: string | null;
    barcode: string | null;
    quantity: number;
    unitCode: string | null;
    unit: string | null;
    unitPrice: number | null;
    grossTotal: number;
    discounts: Discount[];
    lineTotal: number;
    vatRate: number | null;
    vatAmount: number | null;
}

export interface ReviewLine {
    name: string;
    reason: string;
    lineTotal: number | null;
}

export interface VatGroup {
    rate: number | null;
    base: number | null;
    amount: number;
}

export interface Totals {
    goods: number | null;
    discount: number | null;
    surcharge: number | null;
    subtotal: number | null;
    vat: number | null;
    otherTax: number | null;
    withholding: number | null;
    taxIncluded: number | null;
    payable: number | null;
}

export interface Invoice {
    number: string | null;
    ettn: string | null;
    issueDate: string | null;
    dueDate: string | null;
    profile: string | null;
    invoiceType: string | null;
    currency: string | null;
    supplier: Party;
    customer: Party;
    lines: InvoiceLine[];
    review: ReviewLine[];
    skipped: string[];
    vatGroups: VatGroup[];
    totals: Totals;
    linesMatchTotals: boolean | null;
    vatChecked: boolean;
}

export type ParseResult = { ok: true; invoice: Invoice } | { ok: false; reason: string };

export const XML_UNSAFE_MESSAGE = "Bu XML belge tanımı (DOCTYPE) içeriyor; güvenlik nedeniyle okunmadı.";
export const XML_UNREADABLE_MESSAGE = "XML okunamadı; dosya bozuk olabilir.";
export const XML_NOT_INVOICE_MESSAGE = "Bu XML bir e-fatura ya da e-arşiv fatura değil (UBL-TR fatura bekleniyor).";
export const XML_DESPATCH_MESSAGE = "Bu XML bir e-irsaliye, fatura değil. Faturanın XML dosyasını yükleyin.";
export const XML_MANY_INVOICES_MESSAGE = "Bu XML'de birden fazla fatura var; tek faturalık XML yükleyin.";
export const NO_LINES_MESSAGE = "Faturada okunabilen kalem bulunamadı.";
export const LINE_TOTAL_UNREADABLE_MESSAGE = "Satır tutarı okunamadı";
export const QUANTITY_UNREADABLE_MESSAGE = "Miktar okunamadı";

const NO_PARSER_MESSAGE =
    "Bu ortamda DOMParser yok. Node'da @xmldom/xmldom gibi bir DOMParser örneğini ikinci parametre olarak verin.";

const UNIT_NAMES: ReadonlyMap<string, string> = new Map([
    ["C62", "Adet"],
    ["NIU", "Adet"],
    ["EA", "Adet"],
    ["KGM", "Kg"],
    ["GRM", "Gram"],
    ["TNE", "Ton"],
    ["LTR", "Litre"],
    ["MLT", "Ml"],
    ["CLT", "Cl"],
    ["MTR", "Metre"],
    ["MTK", "Metrekare"],
    ["MTQ", "Metreküp"],
    ["KWH", "kWh"],
    ["HUR", "Saat"],
    ["DAY", "Gün"],
    ["MON", "Ay"],
    ["BX", "Kutu"],
    ["PA", "Paket"],
    ["PR", "Çift"],
    ["SET", "Set"],
    ["DZN", "Düzine"],
    ["CEN", "Yüz adet"],
    ["T3", "Bin adet"],
]);

const KDV_CODE = "0015";
const KDV_NAMES: ReadonlySet<string> = new Set(["kdv", "katma deger vergisi", "gercek usulde katma deger vergisi"]);
const FOLDED_LETTERS: Readonly<Record<string, string>> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u" };
const DECIMAL = /^-?\d+(\.\d+)?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BYTE_ORDER_MARK = 0xfeff;

function kids(parent: XmlElement | null, name: string): XmlElement[] {
    return parent ? Array.from(parent.children).filter((element) => element.localName === name) : [];
}

function kid(parent: XmlElement | null, ...path: string[]): XmlElement | null {
    let current = parent;
    for (const name of path) current = kids(current, name)[0] ?? null;
    return current;
}

function text(element: XmlElement | null): string | null {
    const value = element?.textContent?.replace(/\s+/g, " ").trim();
    return value ? value : null;
}

function upper(element: XmlElement | null): string | null {
    return text(element)?.toUpperCase() ?? null;
}

function decimal(element: XmlElement | null): number | null {
    const value = text(element);
    return value !== null && DECIMAL.test(value) ? Number(value) : null;
}

function decimalsOf(element: XmlElement | null): number {
    const match = text(element)?.match(/\.(\d+)$/);
    return match ? match[1].length : 0;
}

function isoDateOf(element: XmlElement | null): string | null {
    const value = text(element);
    return value !== null && ISO_DATE.test(value) ? value : null;
}

function round2(value: number): number {
    return Math.round(value * 100) / 100;
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

function close(a: number, b: number, tolerance: number): boolean {
    return Math.abs(a - b) <= tolerance;
}

function formatAmount(value: number): string {
    return value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fold(value: string): string {
    return value
        .toLocaleLowerCase("tr-TR")
        .replace(/[çğıöşü]/g, (letter) => FOLDED_LETTERS[letter])
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .replace(/[^a-z0-9%]+/g, " ")
        .trim();
}

function partyTaxId(party: XmlElement | null): string | null {
    for (const identification of kids(party, "PartyIdentification")) {
        const id = kid(identification, "ID");
        const scheme = id?.getAttribute("schemeID")?.trim().toUpperCase();
        const value = text(id)?.replace(/\s+/g, "");
        if ((scheme === "VKN" || scheme === "TCKN") && value && /^\d{10,11}$/.test(value)) return value;
    }
    return null;
}

function partyName(party: XmlElement | null): string | null {
    const name = text(kid(party, "PartyName", "Name"));
    if (name) return name;
    const person = kid(party, "Person");
    const full = [text(kid(person, "FirstName")), text(kid(person, "MiddleName")), text(kid(person, "FamilyName"))]
        .filter(Boolean)
        .join(" ");
    return full || null;
}

function partyOf(party: XmlElement | null): Party {
    return {
        name: partyName(party),
        taxId: partyTaxId(party),
        taxOffice: text(kid(party, "PartyTaxScheme", "TaxScheme", "Name")),
    };
}

function isKdv(subtotal: XmlElement): boolean {
    const scheme = kid(subtotal, "TaxCategory", "TaxScheme");
    const code = text(kid(scheme, "TaxTypeCode"));
    if (code !== null) return code === KDV_CODE;
    const name = text(kid(scheme, "Name"));
    return name !== null && KDV_NAMES.has(fold(name));
}

function taxesOf(taxTotals: XmlElement[]): { vat: VatGroup[]; other: number } {
    const vat: VatGroup[] = [];
    let other = 0;
    for (const subtotal of taxTotals.flatMap((taxTotal) => kids(taxTotal, "TaxSubtotal"))) {
        const amount = decimal(kid(subtotal, "TaxAmount")) ?? 0;
        if (isKdv(subtotal)) {
            vat.push({ rate: decimal(kid(subtotal, "Percent")), base: decimal(kid(subtotal, "TaxableAmount")), amount });
        } else {
            other += amount;
        }
    }
    return { vat, other };
}

function isCharge(allowance: XmlElement): boolean {
    const value = text(kid(allowance, "ChargeIndicator"));
    return value === "true" || value === "1";
}

function rateOf(allowance: XmlElement, amount: number): number | null {
    const factor = decimal(kid(allowance, "MultiplierFactorNumeric"));
    const base = decimal(kid(allowance, "BaseAmount"));
    const implied = base !== null && base > 0 ? (amount / base) * 100 : null;
    let rate: number | null;
    if (factor === null) rate = implied;
    else if (implied === null) rate = factor <= 1 ? factor * 100 : factor;
    else rate = Math.abs(factor * 100 - implied) <= Math.abs(factor - implied) ? factor * 100 : factor;
    return rate === null ? null : Math.round(rate * 10000) / 10000;
}

function allowancesOf(line: XmlElement): Discount[] {
    return kids(line, "AllowanceCharge").flatMap((allowance): Discount[] => {
        const amount = decimal(kid(allowance, "Amount"));
        if (amount === null || amount === 0) return [];
        if (isCharge(allowance)) return [{ rate: null, amount: -amount }];
        return [{ rate: rateOf(allowance, amount), amount }];
    });
}

type BuiltLine = { kind: "line"; line: InvoiceLine } | { kind: "review"; review: ReviewLine } | { kind: "skip"; name: string };

function mismatchReason(quantity: number, unitPrice: number, discountTotal: number, expected: number, net: number): string {
    const parts = [quantity, unitPrice, discountTotal, expected, net].map(formatAmount);
    return `Satır tutmuyor: ${parts[0]} × ${parts[1]} - iskonto ${parts[2]} = ${parts[3]}, faturada ${parts[4]}`;
}

function buildLine(element: XmlElement): BuiltLine {
    const item = kid(element, "Item");
    const name = text(kid(item, "Name")) ?? text(kid(item, "Description"));
    if (!name) return { kind: "skip", name: "adı okunamayan satır" };
    const quantityElement = kid(element, "InvoicedQuantity");
    const quantity = decimal(quantityElement);
    const net = decimal(kid(element, "LineExtensionAmount"));
    const priceElement = kid(element, "Price", "PriceAmount");
    const unitPrice = decimal(priceElement);
    const discounts = allowancesOf(element);
    const discountTotal = sum(discounts.map((discount) => discount.amount));

    if (net === null) return { kind: "review", review: { name, reason: LINE_TOTAL_UNREADABLE_MESSAGE, lineTotal: null } };
    if (quantity === null || quantity <= 0) {
        return { kind: "review", review: { name, reason: QUANTITY_UNREADABLE_MESSAGE, lineTotal: net } };
    }
    if (net < -0.005) return { kind: "skip", name };
    if (unitPrice !== null) {
        const expected = quantity * unitPrice - discountTotal;
        const tolerance = 0.011 + quantity * 0.5 * 10 ** -Math.max(2, decimalsOf(priceElement));
        if (!close(expected, net, tolerance)) {
            const reason = mismatchReason(quantity, unitPrice, discountTotal, expected, net);
            return { kind: "review", review: { name, reason, lineTotal: net } };
        }
    }

    const unitCode = quantityElement?.getAttribute("unitCode")?.trim().toUpperCase() || null;
    const vat = taxesOf(kids(element, "TaxTotal")).vat[0] ?? null;
    const barcode = text(kid(item, "StandardItemIdentification", "ID"))?.replace(/\s+/g, "") ?? "";
    const lineTotal = Math.abs(net) < 0.005 ? 0 : net;
    return {
        kind: "line",
        line: {
            name,
            code: text(kid(item, "SellersItemIdentification", "ID")),
            barcode: /^\d{8,14}$/.test(barcode) ? barcode : null,
            quantity,
            unitCode,
            unit: unitCode === null ? null : (UNIT_NAMES.get(unitCode) ?? unitCode),
            unitPrice,
            grossTotal: round2(lineTotal + discountTotal),
            discounts,
            lineTotal,
            vatRate: vat?.rate ?? null,
            vatAmount: vat?.amount ?? null,
        },
    };
}

function invoiceElement(document: XmlDocument): XmlElement | string {
    const root = document.documentElement;
    if (!root) return XML_UNREADABLE_MESSAGE;
    if (root.localName === "Invoice") return root;
    if (root.localName === "DespatchAdvice") return XML_DESPATCH_MESSAGE;
    const nested = Array.from(document.getElementsByTagNameNS("*", "Invoice"));
    if (nested.length === 1) return nested[0];
    return nested.length > 1 ? XML_MANY_INVOICES_MESSAGE : XML_NOT_INVOICE_MESSAGE;
}

function totalsOf(root: XmlElement): { totals: Totals; vatGroups: VatGroup[] } {
    const monetary = kid(root, "LegalMonetaryTotal");
    const amount = (name: string) => decimal(kid(monetary, name));
    const taxes = taxesOf(kids(root, "TaxTotal"));
    const withholding = sum(kids(root, "WithholdingTaxTotal").map((total) => decimal(kid(total, "TaxAmount")) ?? 0));
    return {
        totals: {
            goods: amount("LineExtensionAmount"),
            discount: amount("AllowanceTotalAmount"),
            surcharge: amount("ChargeTotalAmount"),
            subtotal: amount("TaxExclusiveAmount"),
            vat: taxes.vat.length > 0 ? round2(sum(taxes.vat.map((group) => group.amount))) : null,
            otherTax: taxes.other > 0 ? round2(taxes.other) : null,
            withholding: withholding > 0 ? round2(withholding) : null,
            taxIncluded: amount("TaxInclusiveAmount"),
            payable: amount("PayableAmount"),
        },
        vatGroups: taxes.vat,
    };
}

function invoiceAllowance(root: XmlElement): number {
    const allowances = kids(root, "AllowanceCharge").filter((allowance) => !isCharge(allowance));
    return round2(sum(allowances.map((allowance) => decimal(kid(allowance, "Amount")) ?? 0)));
}

function spreadInvoiceDiscount(lines: InvoiceLine[], invoiceDiscount: number, vatGroups: VatGroup[]): InvoiceLine[] {
    const paid = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.lineTotal > 0);
    const netSum = sum(paid.map(({ line }) => line.lineTotal));
    if (invoiceDiscount <= 0 || netSum <= 0) return lines;
    const rates = [...new Set(paid.map(({ line }) => line.vatRate))];
    const printedBase = (rate: number | null) => vatGroups.find((group) => group.rate === rate)?.base ?? null;
    const fromBases = rates.every((rate) => printedBase(rate) !== null);
    const shares = new Array<number>(lines.length).fill(0);
    let assigned = 0;
    rates.forEach((rate, groupIndex) => {
        const members = paid.filter(({ line }) => line.vatRate === rate);
        const groupNet = sum(members.map(({ line }) => line.lineTotal));
        const last = groupIndex === rates.length - 1;
        const groupDiscount = fromBases
            ? round2(groupNet - (printedBase(rate) ?? 0))
            : last
              ? round2(invoiceDiscount - assigned)
              : round2((invoiceDiscount * groupNet) / netSum);
        assigned += groupDiscount;
        let given = 0;
        members.forEach(({ line, index }, memberIndex) => {
            const share =
                memberIndex === members.length - 1
                    ? round2(groupDiscount - given)
                    : round2((groupDiscount * line.lineTotal) / groupNet);
            shares[index] = share;
            given += share;
        });
    });
    return lines.map((line, index): InvoiceLine => {
        const share = shares[index];
        if (share <= 0) return line;
        return {
            ...line,
            lineTotal: line.lineTotal - share,
            discounts: [...line.discounts, { rate: null, amount: share, invoiceShare: true }],
        };
    });
}

interface NetLine {
    net: number;
    vatRate: number | null;
}

function vatGroupsChecked(lines: NetLine[], vatGroups: VatGroup[]): boolean {
    return lines.every((line) => line.vatRate !== null) && vatGroups.length > 0 && vatGroups.every((group) => group.rate !== null);
}

function vatGroupsMatch(lines: NetLine[], vatGroups: VatGroup[]): boolean {
    const groupsMatch = vatGroups.every((group) => {
        const members = lines.filter((line) => line.vatRate === group.rate);
        const base = sum(members.map((line) => line.net));
        const tolerance = 0.011 * (members.length + 1);
        return (
            members.length > 0 &&
            (group.base === null || close(base, group.base, tolerance)) &&
            close((base * (group.rate ?? 0)) / 100, group.amount, tolerance)
        );
    });
    return groupsMatch && lines.every((line) => line.vatRate === 0 || vatGroups.some((group) => group.rate === line.vatRate));
}

function linesMatchTotals(lines: NetLine[], totals: Totals, vatGroups: VatGroup[]): boolean | null {
    const netSum = sum(lines.map((line) => line.net));
    const tolerance = 0.011 * (lines.length + 1);

    const afterDiscount = totals.goods === null ? null : totals.goods - (totals.discount ?? 0) + (totals.surcharge ?? 0);
    const goodsCandidates = [totals.subtotal, totals.goods, afterDiscount].filter((value): value is number => value !== null);
    const goodsMatch = goodsCandidates.length === 0 ? null : goodsCandidates.some((value) => close(netSum, value, tolerance));

    const vatMatch = vatGroupsChecked(lines, vatGroups) ? vatGroupsMatch(lines, vatGroups) : null;

    const payable = totals.payable ?? totals.taxIncluded;
    const taxed = totals.vat !== null || totals.otherTax !== null;
    const withTaxes = netSum + (totals.vat ?? 0) + (totals.otherTax ?? 0);
    const payableMatch =
        payable === null || !taxed
            ? null
            : close(withTaxes - (totals.withholding ?? 0), payable, tolerance) ||
              (totals.taxIncluded !== null && close(withTaxes, totals.taxIncluded, tolerance));

    const checks = [goodsMatch, vatMatch, payableMatch].filter((check): check is boolean => check !== null);
    return checks.length === 0 ? null : checks.every(Boolean);
}

function globalParser(): XmlParser {
    const Parser = (globalThis as { DOMParser?: new () => XmlParser }).DOMParser;
    if (!Parser) throw new Error(NO_PARSER_MESSAGE);
    return new Parser();
}

export function parseUblInvoice(xml: string, parser: XmlParser = globalParser()): ParseResult {
    const source = xml.charCodeAt(0) === BYTE_ORDER_MARK ? xml.slice(1) : xml;
    if (/<!DOCTYPE|<!ENTITY/i.test(source)) return { ok: false, reason: XML_UNSAFE_MESSAGE };
    let document: XmlDocument;
    try {
        document = parser.parseFromString(source, "application/xml");
    } catch {
        return { ok: false, reason: XML_UNREADABLE_MESSAGE };
    }
    if (document.getElementsByTagName("parsererror").length > 0) return { ok: false, reason: XML_UNREADABLE_MESSAGE };
    const root = invoiceElement(document);
    if (typeof root === "string") return { ok: false, reason: root };

    const lines: InvoiceLine[] = [];
    const review: ReviewLine[] = [];
    const skipped: string[] = [];
    for (const built of kids(root, "InvoiceLine").map(buildLine)) {
        if (built.kind === "line") lines.push(built.line);
        else if (built.kind === "review") review.push(built.review);
        else skipped.push(built.name);
    }
    if (lines.length + review.length === 0) return { ok: false, reason: NO_LINES_MESSAGE };

    const { totals, vatGroups } = totalsOf(root);
    const settled = spreadInvoiceDiscount(lines, invoiceAllowance(root), vatGroups);
    const nets: NetLine[] = [
        ...settled.map((line) => ({ net: line.lineTotal, vatRate: line.vatRate })),
        ...review.map((line) => ({ net: line.lineTotal ?? 0, vatRate: null })),
    ];
    const ettn = text(kid(root, "UUID"))?.toLowerCase() ?? null;
    const payments = [...kids(root, "PaymentMeans"), ...kids(root, "PaymentTerms")];
    return {
        ok: true,
        invoice: {
            number: text(kid(root, "ID")),
            ettn: ettn !== null && UUID.test(ettn) ? ettn : null,
            issueDate: isoDateOf(kid(root, "IssueDate")),
            dueDate: payments.map((payment) => isoDateOf(kid(payment, "PaymentDueDate"))).find((date) => date !== null) ?? null,
            profile: upper(kid(root, "ProfileID")),
            invoiceType: upper(kid(root, "InvoiceTypeCode")),
            currency: upper(kid(root, "DocumentCurrencyCode")),
            supplier: partyOf(kid(root, "AccountingSupplierParty", "Party")),
            customer: partyOf(kid(root, "AccountingCustomerParty", "Party")),
            lines: settled,
            review,
            skipped,
            vatGroups,
            totals,
            linesMatchTotals: linesMatchTotals(nets, totals, vatGroups),
            vatChecked: vatGroupsChecked(nets, vatGroups),
        },
    };
}
