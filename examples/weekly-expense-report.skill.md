---
name: weekly-expense-report
description: File last week's receipts from Drive into the Notion finance database. Use when the user asks to file expenses, do the weekly expense report, or log receipts.
apps: [Chrome, Notion]
---

# Weekly Expense Report

> Recorded: 2026-03-14T09:12:00Z
> Platform: macOS

## Description

Pull the previous week's transactions from the bank CSV export and file each one as a row in
the Finance Notion database, so the monthly close has clean data to work from.

## Prerequisites

- Google Chrome
- Notion (logged in)
- Bank CSV export saved to ~/Downloads

## Workflow Steps

### Step 1: Open the Finance database

Navigate to notion.so, then open Finance → Expense DB.

### Step 2: Create a new row

Click "New" and set the Date field to the charge date from the CSV.

### Step 3: Fill the amount and vendor

Type the amount into the Amount field, then type the vendor name into Vendor.

### Step 4: Categorize and save

Select the matching Category, then press Escape to save and close the row.

## Notes

Skip refund lines (negative amounts) — those are reconciled separately at month end.
