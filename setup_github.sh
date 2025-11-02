#!/bin/bash

echo "================================"
echo "🚀 SUBIR A GITHUB (erplago2)"
echo "================================"
echo ""

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

cd /root/mi_erp

# 1. Crear .gitignore
echo -e "${YELLOW}📝 Creando .gitignore...${NC}"
cat > .gitignore << 'EOF'
# Archivos sensibles
afip/certificados/
afip/tokens/
*.key
*.crt
*.csr
*.pem
.env

# Base de datos
*.sql
*.dump
*.dump.gz
dump_*.txt
backups/

# Backups
*.backup*
*.bak*
*.old
*.Old
*.orig
*viejo*
estructura.txt

# Logs
*.log

# Node
node_modules/
npm-debug.log

# Sistema
.DS_Store
Thumbs.db
EOF

# 2. Crear package.json
echo -e "${YELLOW}📦 Creando package.json...${NC}"
cat > package.json << 'EOF'
{
  "name": "erp-lago",
  "version": "1.0.0",
  "description": "Sistema ERP con integración AFIP",
  "main": "server.js",
  "scripts": {
    "start": "node server.js",
    "dev": "nodemon server.js"
  },
  "dependencies": {
    "@afipsdk/afip.js": "^1.2.1",
    "axios": "^1.7.7",
    "bcryptjs": "^2.4.3",
    "cors": "^2.8.5",
    "dotenv": "^16.4.5",
    "express": "^4.21.1",
    "express-rate-limit": "^7.4.1",
    "jsonwebtoken": "^9.0.2",
    "moment": "^2.30.1",
    "pdfkit": "^0.15.0",
    "pg": "^8.13.0",
    "qrcode": "^1.5.4",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "nodemon": "^3.1.7"
  }
}
EOF

# 3. Crear README
echo -e "${YELLOW}📄 Creando README.md...${NC}"
cat > README.md << 'EOF'
# ERP Lago

Sistema ERP para gestión empresarial con integración AFIP.

## Características
- Gestión de productos, clientes, proveedores
- Facturación electrónica (AFIP)
- Control de inventario
- Caja y cobros
- Reportes

## Stack
- Node.js + Express
- PostgreSQL
- HTML/CSS/JS

## Instalación
```bash
npm install
npm start
```

**Nota:** Certificados AFIP no incluidos.
EOF

# 4. Inicializar git si no existe
if [ ! -d .git ]; then
    echo -e "${YELLOW}🔧 Inicializando Git...${NC}"
    git init
fi

# 5. Verificar archivos sensibles
echo -e "${YELLOW}🔍 Verificando archivos sensibles...${NC}"
if find . -name "*.key" -o -name "*.crt" -o -name "dump_*.txt" | grep -q .; then
    echo -e "${RED}⚠️  ADVERTENCIA: Hay archivos sensibles${NC}"
    echo "Asegurate que .gitignore los ignore"
    sleep 2
fi

# 6. Agregar todo
echo -e "${YELLOW}📦 Agregando archivos...${NC}"
git add .

# 7. Mostrar resumen
echo ""
echo -e "${YELLOW}📋 Archivos a subir:${NC}"
git status --short | head -30

# 8. Commit
echo ""
echo -e "${YELLOW}💾 Commit...${NC}"
git commit -m "Initial commit - ERP Lago" 2>/dev/null || git commit -m "Update ERP Lago"

# 9. Pedir usuario
echo ""
read -p "Tu usuario de GitHub: " GITHUB_USER

# 10. Configurar remote
REPO_URL="https://github.com/$GITHUB_USER/erplago2.git"

if git remote | grep -q "origin"; then
    git remote remove origin
fi

git remote add origin $REPO_URL
git branch -M main

# 11. Push
echo ""
echo -e "${YELLOW}📤 Subiendo a GitHub...${NC}"
echo -e "${YELLOW}Usá tu TOKEN como contraseña${NC}"
echo ""

if git push -u origin main --force; then
    echo ""
    echo -e "${GREEN}================================${NC}"
    echo -e "${GREEN}🎉 ¡SUBIDO EXITOSAMENTE!${NC}"
    echo -e "${GREEN}================================${NC}"
    echo ""
    echo -e "Ver en: ${GREEN}https://github.com/$GITHUB_USER/erplago2${NC}"
else
    echo ""
    echo -e "${RED}❌ Error al subir${NC}"
    echo ""
    echo "Ejecutá manualmente:"
    echo "git push -u origin main --force"
fi
EOF

chmod +x push_to_github.sh
