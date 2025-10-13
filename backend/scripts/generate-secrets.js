#!/usr/bin/env node

/**
 * Generate secure random secrets for JWT and API keys
 * Run: node scripts/generate-secrets.js
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

function generateSecrets() {
  console.log('🔐 Generating secure secrets...\n');

  const secrets = {
    JWT_SECRET: generateSecret(64),
    API_KEY_SALT: generateSecret(32)
  };

  console.log('Generated secrets:');
  console.log('─────────────────────────────────────────────────');
  console.log(`JWT_SECRET=${secrets.JWT_SECRET}`);
  console.log(`API_KEY_SALT=${secrets.API_KEY_SALT}`);
  console.log('─────────────────────────────────────────────────\n');

  // Check if .env exists
  const envPath = path.join(__dirname, '..', '.env');
  const envExamplePath = path.join(__dirname, '..', '.env.example');

  if (!fs.existsSync(envPath)) {
    console.log('❌ .env file not found.');
    console.log('💡 Creating .env from .env.example...\n');

    if (fs.existsSync(envExamplePath)) {
      fs.copyFileSync(envExamplePath, envPath);
      console.log('✅ Created .env file\n');
    } else {
      console.log('❌ .env.example not found. Creating minimal .env...\n');
      fs.writeFileSync(envPath, '# CryptoPay Backend Configuration\n\n');
    }
  }

  // Read current .env
  let envContent = fs.readFileSync(envPath, 'utf8');

  // Update or append secrets
  Object.entries(secrets).forEach(([key, value]) => {
    const regex = new RegExp(`^${key}=.*$`, 'm');

    if (regex.test(envContent)) {
      // Check if already has a value
      const currentMatch = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
      if (currentMatch && currentMatch[1] && currentMatch[1].trim()) {
        console.log(`⚠️  ${key} already set, skipping...`);
      } else {
        // Replace empty value
        envContent = envContent.replace(regex, `${key}=${value}`);
        console.log(`✅ Updated ${key} in .env`);
      }
    } else {
      // Append
      envContent += `\n${key}=${value}`;
      console.log(`✅ Added ${key} to .env`);
    }
  });

  // Write back
  fs.writeFileSync(envPath, envContent);

  console.log('\n🎉 Done! Your .env file has been updated with secure secrets.');
  console.log('🔒 Keep these secrets safe and never commit them to git!\n');
}

// Run if called directly
if (require.main === module) {
  generateSecrets();
}

module.exports = { generateSecret, generateSecrets };
