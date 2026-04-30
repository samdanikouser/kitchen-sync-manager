import React, { useState } from 'react';
import { api } from '../lib/api';
import { Item, Recipe, SalesEntry, Purchase, StockEntry } from '../types';
import { FileText, Download, FileSpreadsheet, File as FilePdf, Calendar, RefreshCcw } from 'lucide-react';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { formatCurrency, formatNumber } from '../lib/utils';
import * as XLSX from 'xlsx';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { useSettings } from '../lib/SettingsContext';

export default function Reports() {
  const { settings } = useSettings();
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'));
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'));
  const [loading, setLoading] = useState(false);

  const fetchFullDataset = async () => {
    setLoading(true);
    try {
      const [iData, rData, saData, pData, stData] = await Promise.all([
        api.items.list(),
        api.recipes.list(),
        api.sales.list(),
        api.purchases.list(),
        api.stock.list()
      ]);

      const filteredSales = saData.filter(s => s.date >= startDate && s.date <= endDate);
      const filteredPurchases = pData.filter(p => p.date >= startDate && p.date <= endDate);
      const filteredStock = stData.filter(s => s.date >= startDate && s.date <= endDate);

      return {
        items: iData,
        recipes: rData,
        sales: filteredSales,
        purchases: filteredPurchases,
        stock: filteredStock
      };
    } catch (err) {
      console.error("Error fetching report dataset:", err);
      return null;
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = async () => {
    const data = await fetchFullDataset();
    if (!data) return;

    const workbook = XLSX.utils.book_new();

    // Sales Report
    const salesData = data.sales.map(s => ({
      Date: s.date,
      Recipe: data.recipes.find(r => r.id === s.recipeId)?.name || 'Unknown',
      Quantity: s.quantitySold,
      Price: data.recipes.find(r => r.id === s.recipeId)?.sellingPrice || 0,
      Total: (data.recipes.find(r => r.id === s.recipeId)?.sellingPrice || 0) * s.quantitySold
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salesData), 'Sales');

    // Purchases Report
    const purchaseData = data.purchases.map(p => ({
      Date: p.date,
      Item: data.items.find(i => i.id === p.itemId)?.name || 'Unknown',
      Quantity: p.quantity,
      UnitPrice: p.unitPrice,
      Total: p.quantity * p.unitPrice,
      Vendor: p.vendor || ''
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(purchaseData), 'Purchases');

    // Inventory Report
    const invData = data.items.map(i => ({
      Name: i.name,
      Unit: i.unit,
      PurchasePrice: i.purchasePrice,
      Yield: i.yieldPercentage + '%',
      ParLevel: i.parLevel
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(invData), 'InventoryMaster');

    // Closing Stock Report
    const stockData = data.stock.map(s => ({
      Date: s.date,
      Item: data.items.find(i => i.id === s.itemId)?.name || 'Unknown',
      ClosingQty: s.closingQuantity,
      Unit: data.items.find(i => i.id === s.itemId)?.unit || ''
    }));
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(stockData), 'ClosingStock');

    XLSX.writeFile(workbook, `Kitchen_Report_${startDate}_to_${endDate}.xlsx`);
  };

  const exportToPdf = async () => {
    const data = await fetchFullDataset();
    if (!data) return;

    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.text('Kitchen Management Report', 14, 22);
    doc.setFontSize(10);
    doc.text(`Period: ${startDate} to ${endDate}`, 14, 30);

    // Sales Summary
    doc.setFontSize(14);
    doc.text('Sales Summary', 14, 45);
    const salesTable = data.sales.map(s => {
      const r = data.recipes.find(rec => rec.id === s.recipeId);
      return [
        s.date,
        r?.name || 'Unknown',
        s.quantitySold,
        formatCurrency(r?.sellingPrice || 0, settings.currency.code),
        formatCurrency((r?.sellingPrice || 0) * s.quantitySold, settings.currency.code)
      ];
    });

    autoTable(doc, {
      startY: 50,
      head: [['Date', 'Recipe', 'Qty', 'Unit Price', 'Total Sales']],
      body: salesTable,
    });

    // Purchases Summary
    doc.addPage();
    doc.text('Purchases Summary', 14, 22);
    const purchasesTable = data.purchases.map(p => {
      const it = data.items.find(item => item.id === p.itemId);
      return [
        p.date,
        it?.name || 'Unknown',
        p.quantity,
        formatCurrency(p.unitPrice, settings.currency.code),
        formatCurrency(p.quantity * p.unitPrice, settings.currency.code),
        p.vendor || '-'
      ];
    });

    autoTable(doc, {
      startY: 30,
      head: [['Date', 'Item', 'Qty', 'Unit Price', 'Total Cost', 'Vendor']],
      body: purchasesTable,
    });

    // Closing Stock Summary
    doc.addPage();
    doc.text('Closing Stock Summary', 14, 22);
    const stockTable = data.stock.map(s => {
      const it = data.items.find(item => item.id === s.itemId);
      return [
        s.date,
        it?.name || 'Unknown',
        formatNumber(s.closingQuantity),
        it?.unit || '-'
      ];
    });

    autoTable(doc, {
      startY: 30,
      head: [['Date', 'Item', 'Closing Qty', 'Unit']],
      body: stockTable,
    });

    doc.save(`Kitchen_Report_${startDate}_to_${endDate}.pdf`);
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-black tracking-tighter text-zinc-900 uppercase">Reports Center</h1>
        <p className="text-zinc-500 font-medium tracking-tight">Export your operational data for accounting and analysis.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1 space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm space-y-4">
            <h3 className="text-sm font-black uppercase tracking-widest text-zinc-400 flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Report Period
            </h3>
            <div className="space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Start Date</label>
                <input 
                  type="date" 
                  value={startDate} 
                  onChange={e => setStartDate(e.target.value)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-bold uppercase tracking-widest focus:ring-2 focus:ring-zinc-900 outline-none"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">End Date</label>
                <input 
                  type="date" 
                  value={endDate} 
                  onChange={e => setEndDate(e.target.value)}
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-sm font-bold uppercase tracking-widest focus:ring-2 focus:ring-zinc-900 outline-none"
                />
              </div>
            </div>
            
            <div className="pt-4 border-t border-zinc-100 flex flex-col gap-3">
              <button
                onClick={exportToExcel}
                disabled={loading}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-green-600 px-4 py-3 text-sm font-bold text-white hover:bg-green-700 transition-all shadow-lg shadow-green-100 disabled:opacity-50"
              >
                {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                Export to Excel (.xlsx)
              </button>
              <button
                onClick={exportToPdf}
                disabled={loading}
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-bold text-white hover:bg-red-700 transition-all shadow-lg shadow-red-100 disabled:opacity-50"
              >
                {loading ? <RefreshCcw className="h-4 w-4 animate-spin" /> : <FilePdf className="h-4 w-4" />}
                Export to PDF (.pdf)
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm text-center">
            <div className="max-w-md mx-auto space-y-4">
              <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-zinc-50 text-zinc-300">
                <FileText className="h-8 w-8" />
              </div>
              <h2 className="text-xl font-black text-zinc-900">Custom Accounting Reports</h2>
              <p className="text-zinc-500 text-sm leading-relaxed">
                Generate detailed audits of your consumption, sales performance, and procurement activities. 
                These files include item-level breakdowns and total tax-inclusive valuations.
              </p>
              <div className="grid grid-cols-2 gap-4 pt-4">
                <div className="bg-zinc-50 rounded-xl p-4 text-left">
                  <p className="text-[10px] font-black text-zinc-400 uppercase mb-1">Sales Audit</p>
                  <p className="text-xs text-zinc-600">Recipe consumption and revenue tracking.</p>
                </div>
                <div className="bg-zinc-50 rounded-xl p-4 text-left">
                  <p className="text-[10px] font-black text-zinc-400 uppercase mb-1">Stock Ledger</p>
                  <p className="text-xs text-zinc-600">Historical stock entries and variance paths.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
