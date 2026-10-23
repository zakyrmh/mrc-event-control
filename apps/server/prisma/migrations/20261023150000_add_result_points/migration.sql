-- Migration 20261023150000_add_result_points
-- Juri menetapkan poin per pertandingan; sistem tidak menghitungnya.
-- Diperlukan untuk menentukan juara grup (poin tertinggi) sebelum bracket.

ALTER TABLE "ResultRevision" ADD COLUMN "pointsA" INTEGER;
ALTER TABLE "ResultRevision" ADD COLUMN "pointsB" INTEGER;
