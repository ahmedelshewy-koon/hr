-- A cost center can be created before finance assigns its payroll debit account.
ALTER TABLE "cost_centers" ALTER COLUMN "debit_account" DROP NOT NULL;
