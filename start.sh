#!/bin/bash

# Download the database file from the environment variable URL
if [ ! -z "$BACKUP_DB_URL" ]; then
    echo "Restoring backup database..."
    curl -o data/db.sqlite "$BACKUP_DB_URL"
    
    if [ $? -eq 0 ]; then
        echo "Backup Database restored successfully"
    else
        echo "Error restoring backup database"
    fi
else
    echo "Backup DB not found, skipping context restoration..."
fi

# Track if character file was downloaded
CHARACTER_DOWNLOADED=0
if [ ! -z "$CHARACTER_FILE_URL" ]; then
    echo "Downloading character file..."
    curl -o characters/default.character.json "$CHARACTER_FILE_URL"
    
    if [ $? -eq 0 ]; then
        echo "Character file downloaded successfully"
        CHARACTER_DOWNLOADED=1
    else
        echo "Error downloading character file"
    fi
else
    echo "Character file URL not found, skipping download..."
fi

# Start the agent using pnpm
if [ $CHARACTER_DOWNLOADED -eq 1 ]; then
    pnpm start --character characters/default.character.json
else
    pnpm start
fi
