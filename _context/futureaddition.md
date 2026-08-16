FUTURE FEATURE SPECIFICATION: Automated CSV Data Ingestion

Target: AI Developer / Agentic Tool

System: JAI Conclave 2026 EMD (Google Workspace Apps Script Backend)1. Feature Overview

Currently, verified participants are manually pasted into the 01_Participants_Master sheet. To streamline data porting from external registration platforms, we need an automated CSV ingestion script.

The script will monitor a specific Google Drive folder for a participants.csv file, validate its structure against our database schema, safely append new records to the Master sheet, and archive the file to prevent duplicate imports.2. Infrastructure & Configuration Updates

The AI should instruct the user to make the following updates to the 00_Configuration sheet to support this feature:

    Add CSV_Import_Folder_ID (The Drive folder where raw CSVs are dropped).
    Add CSV_Archive_Folder_ID (The Drive folder where processed CSVs are moved to prevent double-processing).

3. Core Logic & Constraints

The AI must implement the Apps Script with the following strict rules:

A. Schema Validation & Column Mapping

    The script must read Row 1 of 01_Participants_Master to establish the target schema (e.g., Full_Name, Email_Address, Phone_Number, Track).
    The script must read the header row of the incoming participants.csv.
    Dynamic Mapping: The script must NOT rely on static column letters (e.g., "Column B is Name"). Instead, it must dynamically map the CSV columns to the EMD columns based on matching header names. If the CSV has columns that do not exist in the EMD, they should be ignored.

B. The Participant_ID Exclusion Rule

    The Participant_ID column (Column A in the EMD) MUST remain completely blank during this import process.
    The EMD already has a dedicated assignParticipantIDs() script (Phase 2) that handles permanent ID generation and duplicate detection. The CSV importer's only job is to port the raw data into the correct columns.

C. Safe Appending & Idempotency

    The script should compile the mapped data into a 2D array and use batch writing (e.g., sheet.getRange(...).setValues()) starting at the first empty row (getLastRow() + 1).
    To prevent the same CSV from being imported twice, the script MUST move the file from the CSV_Import_Folder_ID to the CSV_Archive_Folder_ID immediately after a successful database write, or rename the file with a [PROCESSED_Timestamp] prefix.

D. Error Handling & Logging

    If the CSV headers are completely incompatible with the EMD, the script should abort and log an error.
    The script must utilize the existing logAutomation(automationName, recordsProcessed, status, errorDetails) helper function to record the import event in the 05_Automation_Log sheet.
        Example Log: automationName: "CSV Import", recordsProcessed: 150, status: "Success", errorDetails: "Processed batch_1.csv and moved to archive."

4. Expected Output from AI

When implementing this feature, the AI should generate:

    A standalone Apps Script file (e.g., 07_CSVImporter.gs).
    The importCSVData() function utilizing DriveApp, Utilities.parseCsv(), and dynamic array mapping.
    Instructions on how to set up a Time-Driven Trigger (e.g., "Run every hour") to make the ingestion pipeline fully automated.
