import { readFileSync } from "node:fs";
import { DOMParser } from "@xmldom/xmldom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    LINE_TOTAL_UNREADABLE_MESSAGE,
    NO_LINES_MESSAGE,
    QUANTITY_UNREADABLE_MESSAGE,
    XML_DESPATCH_MESSAGE,
    XML_MANY_INVOICES_MESSAGE,
    XML_NOT_INVOICE_MESSAGE,
    XML_UNREADABLE_MESSAGE,
    XML_UNSAFE_MESSAGE,
    parseUblInvoice,
    type Invoice,
} from "./index.js";

const sampleXml = readFileSync(new URL("./fixtures/ornek-fatura.xml", import.meta.url), "utf8");
const parser = new DOMParser();

function invoiceOf(xml: string): Invoice {
    const result = parseUblInvoice(xml, parser);
    if (!result.ok) throw new Error(result.reason);
    return result.invoice;
}

const NS = [
    'xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"',
    'xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"',
    'xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"',
].join(" ");

function kdv(rate: number, base: number, amount: number): string {
    return `<cac:TaxSubtotal><cbc:TaxableAmount>${base}</cbc:TaxableAmount><cbc:TaxAmount>${amount}</cbc:TaxAmount><cbc:Percent>${rate}</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>`;
}

interface LineSpec {
    name?: string;
    qty?: string;
    unit?: string;
    price?: string;
    net: string;
    allowances?: string;
    vat?: [number, number];
    item?: string;
}

function line({ name = "Domates", qty = "10", unit = "KGM", price = "20", net, allowances = "", vat = [1, 2], item = "" }: LineSpec): string {
    return `<cac:InvoiceLine><cbc:ID>1</cbc:ID><cbc:InvoicedQuantity unitCode="${unit}">${qty}</cbc:InvoicedQuantity><cbc:LineExtensionAmount>${net}</cbc:LineExtensionAmount>${allowances}<cac:TaxTotal><cbc:TaxAmount>${vat[1]}</cbc:TaxAmount>${kdv(vat[0], Number(net), vat[1])}</cac:TaxTotal><cac:Item><cbc:Name>${name}</cbc:Name>${item}</cac:Item><cac:Price><cbc:PriceAmount>${price}</cbc:PriceAmount></cac:Price></cac:InvoiceLine>`;
}

interface DocSpec {
    root?: string;
    profile?: string;
    type?: string;
    currency?: string;
    supplier?: string;
    extra?: string;
    taxes?: string;
    totals: string;
    lines: string;
}

function doc({ root = "Invoice", profile = "TEMELFATURA", type = "SATIS", currency = "TRY", supplier, extra = "", taxes = "", totals, lines }: DocSpec): string {
    const party =
        supplier ??
        '<cac:PartyIdentification><cbc:ID schemeID="VKN">1000000034</cbc:ID></cac:PartyIdentification><cac:PartyName><cbc:Name>Örnek Manav</cbc:Name></cac:PartyName>';
    return `<?xml version="1.0" encoding="UTF-8"?><${root} ${NS}><cbc:ProfileID>${profile}</cbc:ProfileID><cbc:ID>TST2026000000001</cbc:ID><cbc:UUID>5b40c9c9-77c0-47a3-bc60-e508add6b5db</cbc:UUID><cbc:IssueDate>2026-09-14</cbc:IssueDate><cbc:InvoiceTypeCode>${type}</cbc:InvoiceTypeCode><cbc:DocumentCurrencyCode>${currency}</cbc:DocumentCurrencyCode><cac:AccountingSupplierParty><cac:Party>${party}</cac:Party></cac:AccountingSupplierParty>${extra}<cac:TaxTotal>${taxes}</cac:TaxTotal><cac:LegalMonetaryTotal>${totals}</cac:LegalMonetaryTotal>${lines}</${root}>`;
}

function monetary(goods: number, subtotal: number, taxIncluded: number, payable: number, discount?: number): string {
    const allowance = discount === undefined ? "" : `<cbc:AllowanceTotalAmount>${discount}</cbc:AllowanceTotalAmount>`;
    return `<cbc:LineExtensionAmount>${goods}</cbc:LineExtensionAmount><cbc:TaxExclusiveAmount>${subtotal}</cbc:TaxExclusiveAmount><cbc:TaxInclusiveAmount>${taxIncluded}</cbc:TaxInclusiveAmount>${allowance}<cbc:PayableAmount>${payable}</cbc:PayableAmount>`;
}

const simpleTotals = monetary(200, 200, 202, 202);
const invoiceDiscount = "<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:Amount>20</cbc:Amount></cac:AllowanceCharge>";

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("örnek fatura", () => {
    it("başlık, taraflar, KDV dökümü ve toplamlar okunur; kalemler toplamlarla tutar", () => {
        expect(invoiceOf(sampleXml)).toMatchObject({
            number: "ORN2026000000042",
            ettn: "ff0afb9c-74a4-4e2f-81db-b1f1e4da1799",
            issueDate: "2026-10-01",
            dueDate: "2026-10-31",
            profile: "TICARIFATURA",
            invoiceType: "SATIS",
            currency: "TRY",
            supplier: { name: "Örnek Gıda Ltd. Şti.", taxId: "9876543217", taxOffice: "Deneme" },
            customer: { name: "Deneme Ticaret A.Ş.", taxId: "1234567890", taxOffice: "Örnek" },
            review: [],
            skipped: [],
            vatGroups: [
                { rate: 1, base: 2771.05, amount: 27.71 },
                { rate: 20, base: 1477.46, amount: 295.49 },
            ],
            totals: {
                goods: 4956.9,
                discount: 708.39,
                surcharge: null,
                subtotal: 4248.51,
                vat: 323.2,
                otherTax: null,
                withholding: null,
                taxIncluded: 4571.71,
                payable: 4571.71,
            },
            linesMatchTotals: true,
            vatChecked: true,
        });
    });

    it("kalemler, iskonto kademeleri ve birimler faturadaki gibi gelir", () => {
        const { lines } = invoiceOf(sampleXml);
        expect(lines[0]).toEqual({
            name: "Domates salçası 830 g",
            code: "ORN-001",
            barcode: null,
            quantity: 2,
            unitCode: "BX",
            unit: "Kutu",
            unitPrice: 840,
            grossTotal: 1680,
            discounts: [
                { rate: 8.33, amount: 139.94 },
                { rate: 20, amount: 308.01 },
            ],
            lineTotal: 1232.05,
            vatRate: 1,
            vatAmount: 12.32,
        });
        expect(lines.map((item) => [item.name, item.quantity, item.unit, item.unitPrice, item.discounts.map((d) => d.rate), item.lineTotal, item.vatRate])).toEqual([
            ["Domates salçası 830 g", 2, "Kutu", 840, [8.33, 20], 1232.05, 1],
            ["Baldo pirinç", 25, "Kg", 68.4, [10], 1539, 1],
            ["Bulaşık deterjanı 4 kg", 6, "Adet", 189.9, [5, 3], 1049.96, 20],
            ["Kağıt peçete (100 adet)", 10, "Paket", 42.75, [], 427.5, 20],
        ]);
        expect(lines[1].barcode).toBe("2001234567893");
    });

    it("başında UTF-8 BOM olan dosya da okunur", () => {
        expect(invoiceOf(String.fromCharCode(0xfeff) + sampleXml).number).toBe("ORN2026000000042");
    });
});

describe("kalemler", () => {
    it("birim kodu okunur adıyla gelir; ürün kodu ve barkod okunur", () => {
        const invoice = invoiceOf(
            doc({
                totals: simpleTotals,
                taxes: kdv(1, 200, 2),
                lines: line({
                    unit: "KGM",
                    net: "200",
                    item: "<cac:SellersItemIdentification><cbc:ID>ORN-K01</cbc:ID></cac:SellersItemIdentification><cac:StandardItemIdentification><cbc:ID>2001234567893</cbc:ID></cac:StandardItemIdentification>",
                }),
            }),
        );
        expect(invoice.lines[0]).toMatchObject({ code: "ORN-K01", barcode: "2001234567893", unitCode: "KGM", unit: "Kg", quantity: 10, lineTotal: 200, vatRate: 1, vatAmount: 2 });
        expect(invoice.linesMatchTotals).toBe(true);
    });

    it("fatura altı iskonto kalemlere KDV grubu içinde dağıtılır", () => {
        const invoice = invoiceOf(
            doc({ extra: invoiceDiscount, totals: monetary(200, 180, 181.8, 181.8, 20), taxes: kdv(1, 180, 1.8), lines: line({ net: "200" }) }),
        );
        expect(invoice.lines[0]).toMatchObject({ lineTotal: 180, discounts: [{ rate: null, amount: 20, invoiceShare: true }] });
        expect(invoice.linesMatchTotals).toBe(true);
    });

    it("bedelsiz kalemler fatura altı iskontodan pay almaz", () => {
        const free = (name: string) => line({ name, qty: "1", unit: "C62", price: "0", net: "0", vat: [20, 0] });
        const invoice = invoiceOf(
            doc({
                extra: invoiceDiscount,
                totals: monetary(200, 180, 181.8, 181.8, 20),
                taxes: kdv(1, 180, 1.8) + kdv(20, 0, 0),
                lines: line({ net: "200" }) + free("Hediye bardak") + free("Hediye tabak"),
            }),
        );
        expect(invoice.lines.map((item) => item.lineTotal)).toEqual([180, 0, 0]);
        expect(invoice.lines[2].discounts).toEqual([]);
        expect(invoice.linesMatchTotals).toBe(true);
    });

    it("artırım eksi kademe olur; brütten kademeler düşülünce satır tutarı çıkar", () => {
        const invoice = invoiceOf(
            doc({
                totals: monetary(210, 210, 212.1, 212.1),
                taxes: kdv(1, 210, 2.1),
                lines: line({
                    net: "210",
                    allowances: "<cac:AllowanceCharge><cbc:ChargeIndicator>true</cbc:ChargeIndicator><cbc:Amount>10</cbc:Amount></cac:AllowanceCharge>",
                    vat: [1, 2.1],
                }),
            }),
        );
        expect(invoice.lines[0]).toMatchObject({ lineTotal: 210, grossTotal: 200, discounts: [{ rate: null, amount: -10 }] });
    });

    it("oran olarak yazılan 1 yüzde 1 sayılır; artırım 1 ile işaretlenebilir; bilinmeyen birim kodu kalır", () => {
        const invoice = invoiceOf(
            doc({
                totals: simpleTotals,
                taxes: kdv(1, 200, 2),
                lines: line({
                    unit: "CS",
                    price: "20.2",
                    net: "200",
                    allowances:
                        "<cac:AllowanceCharge><cbc:ChargeIndicator>false</cbc:ChargeIndicator><cbc:MultiplierFactorNumeric>1</cbc:MultiplierFactorNumeric><cbc:Amount>2.02</cbc:Amount><cbc:BaseAmount>202</cbc:BaseAmount></cac:AllowanceCharge>" +
                        "<cac:AllowanceCharge><cbc:ChargeIndicator>1</cbc:ChargeIndicator><cbc:Amount>0.02</cbc:Amount></cac:AllowanceCharge>",
                }),
            }),
        );
        expect(invoice.lines[0]).toMatchObject({
            unitCode: "CS",
            unit: "CS",
            discounts: [
                { rate: 1, amount: 2.02 },
                { rate: null, amount: -0.02 },
            ],
            lineTotal: 200,
        });
    });

    it("tutmayan, tutarı ya da miktarı okunamayan kalem kontrol listesine düşer", () => {
        const invoice = invoiceOf(
            doc({
                totals: simpleTotals,
                lines: line({ name: "Tutmayan", net: "150" }) + line({ name: "Tutarsız", net: "" }) + line({ name: "Miktarsız", qty: "", net: "50" }),
            }),
        );
        expect(invoice.lines).toEqual([]);
        expect(invoice.review).toEqual([
            { name: "Tutmayan", reason: "Satır tutmuyor: 10,00 × 20,00 - iskonto 0,00 = 200,00, faturada 150,00", lineTotal: 150 },
            { name: "Tutarsız", reason: LINE_TOTAL_UNREADABLE_MESSAGE, lineTotal: null },
            { name: "Miktarsız", reason: QUANTITY_UNREADABLE_MESSAGE, lineTotal: 50 },
        ]);
        expect(invoice.vatChecked).toBe(false);
    });

    it("adı olmayan ve tutarı eksi olan kalem atlanır", () => {
        const invoice = invoiceOf(
            doc({
                totals: simpleTotals,
                taxes: kdv(1, 200, 2),
                lines: line({ net: "200" }) + line({ name: "", net: "5" }) + line({ name: "Eksi satır", qty: "1", price: "-10", net: "-10" }),
            }),
        );
        expect(invoice.lines).toHaveLength(1);
        expect(invoice.skipped).toEqual(["adı okunamayan satır", "Eksi satır"]);
    });
});

describe("vergiler ve toplamlar", () => {
    it("ÖTV KDV dökümüne girmez; tevkifat, e-Arşiv profili ve şahıs satıcı okunur", () => {
        const invoice = invoiceOf(
            doc({
                profile: "EARSIVFATURA",
                supplier:
                    '<cac:PartyIdentification><cbc:ID schemeID="TCKN">10000000146</cbc:ID></cac:PartyIdentification><cac:Person><cbc:FirstName>Ayşe</cbc:FirstName><cbc:FamilyName>Örnek</cbc:FamilyName></cac:Person>',
                taxes:
                    kdv(20, 200, 40) +
                    "<cac:TaxSubtotal><cbc:TaxableAmount>200</cbc:TaxableAmount><cbc:TaxAmount>50</cbc:TaxAmount><cbc:Percent>25</cbc:Percent><cac:TaxCategory><cac:TaxScheme><cbc:Name>ÖTV</cbc:Name><cbc:TaxTypeCode>0071</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal>",
                extra: "<cac:WithholdingTaxTotal><cbc:TaxAmount>20</cbc:TaxAmount></cac:WithholdingTaxTotal>",
                totals: monetary(200, 200, 290, 270),
                lines: line({ net: "200", vat: [20, 40] }),
            }),
        );
        expect(invoice).toMatchObject({
            profile: "EARSIVFATURA",
            supplier: { name: "Ayşe Örnek", taxId: "10000000146", taxOffice: null },
            vatGroups: [{ rate: 20, base: 200, amount: 40 }],
            totals: { vat: 40, otherTax: 50, withholding: 20, taxIncluded: 290, payable: 270 },
            linesMatchTotals: true,
        });
    });

    it("vergiler dahil ve ödenecek tutar kalemlerle tutmazsa uzlaşmaz", () => {
        const invoice = invoiceOf(doc({ totals: monetary(200, 200, 250, 250), taxes: kdv(1, 200, 2), lines: line({ net: "200" }) }));
        expect(invoice.linesMatchTotals).toBe(false);
    });

    it("KDV adı kodsuz yazılmışsa addan tanınır", () => {
        const named = kdv(1, 200, 2).replace("<cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode>", "<cbc:Name>KATMA DEĞER VERGİSİ</cbc:Name>");
        expect(invoiceOf(doc({ totals: simpleTotals, taxes: named, lines: line({ net: "200" }) })).vatGroups).toEqual([{ rate: 1, base: 200, amount: 2 }]);
    });

    it("iade faturası ve döviz faturası da okunur", () => {
        const base = { totals: simpleTotals, taxes: kdv(1, 200, 2), lines: line({ net: "200" }) };
        expect(invoiceOf(doc({ ...base, type: "IADE" })).invoiceType).toBe("IADE");
        expect(invoiceOf(doc({ ...base, currency: "USD" })).currency).toBe("USD");
    });
});

describe("dosya kontrolleri", () => {
    const inner = doc({ totals: simpleTotals, taxes: kdv(1, 200, 2), lines: line({ net: "200" }) }).replace('<?xml version="1.0" encoding="UTF-8"?>', "");

    it("GİB zarfındaki tek fatura okunur; iki faturalı dosya reddedilir", () => {
        expect(invoiceOf(`<sh:StandardBusinessDocument xmlns:sh="urn:sbd"><Package>${inner}</Package></sh:StandardBusinessDocument>`).number).toBe("TST2026000000001");
        expect(parseUblInvoice(`<Paket>${inner}${inner}</Paket>`, parser)).toEqual({ ok: false, reason: XML_MANY_INVOICES_MESSAGE });
    });

    it("irsaliye, fatura olmayan, kalemsiz, bozuk ve belge tanımlı XML reddedilir", () => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
        const refusal = (xml: string) => parseUblInvoice(xml, parser);
        expect(refusal(doc({ root: "DespatchAdvice", totals: simpleTotals, lines: line({ net: "200" }) }))).toEqual({ ok: false, reason: XML_DESPATCH_MESSAGE });
        expect(refusal("<ApplicationResponse/>")).toEqual({ ok: false, reason: XML_NOT_INVOICE_MESSAGE });
        expect(refusal(doc({ totals: simpleTotals, lines: "" }))).toEqual({ ok: false, reason: NO_LINES_MESSAGE });
        expect(refusal("<Invoice><cbc:ID>")).toEqual({ ok: false, reason: XML_UNREADABLE_MESSAGE });
        expect(refusal('<!DOCTYPE x [<!ENTITY a "aaaa">]><Invoice>&a;</Invoice>')).toEqual({ ok: false, reason: XML_UNSAFE_MESSAGE });
    });

    it("tarayıcının bozuk XML için döndürdüğü parsererror belgesi okunamadı sayılır", () => {
        const browserError = '<parsererror xmlns="http://www.mozilla.org/newlayout/xml/parsererror.xml">1:10: unexpected close tag.</parsererror>';
        expect(parseUblInvoice(browserError, parser)).toEqual({ ok: false, reason: XML_UNREADABLE_MESSAGE });
    });
});

describe("DOMParser seçimi", () => {
    it("parser verilmezse ortamdaki DOMParser kullanılır", () => {
        vi.stubGlobal("DOMParser", DOMParser);
        expect(parseUblInvoice(sampleXml)).toMatchObject({ ok: true, invoice: { number: "ORN2026000000042" } });
    });

    it("ortamda DOMParser yoksa ne yapılacağını söyleyen bir hata fırlatır", () => {
        expect(() => parseUblInvoice(sampleXml)).toThrow("Node'da @xmldom/xmldom gibi bir DOMParser");
    });
});
