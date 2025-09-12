# 1. Přepsat URL existujícího remote (pokud je potřeba)
git remote set-url origin https://github.com/Vilem23/Card-Game.git

# 2. Přidat všechny soubory (včetně nového klient.js)
git add -A

# 3. Vytvořit commit se zprávou
git commit -m "Přidán klient.js a úpravy index.html + server.js"

# 4. Pushnout na GitHub (hlavní větev main)
git branch -M main
git push -u origin main
