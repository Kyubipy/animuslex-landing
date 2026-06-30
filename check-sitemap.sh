#!/bin/bash
# check-sitemap.sh — verifica que sitemap.xml liste TODAS las paginas HTML reales del fs
# Uso: ./check-sitemap.sh
# Exit code 0 si OK, 1 si falta alguna URL.
#
# Roberto pidio "que no se repita" — agregar pagina sin actualizar sitemap
# ya genero el bug del ROI no listado en jun-2026.

set -e
cd "$(dirname "$0")"

REAL=$(mktemp); LISTED=$(mktemp); MISSING=$(mktemp)
trap "rm -f $REAL $LISTED $MISSING" EXIT

# Paginas reales HTML en root (sin gracias.html que es post-form noindex)
for f in *.html; do
    [ -f "$f" ] || continue
    [ "$f" = "gracias.html" ] && continue
    if [ "$f" = "index.html" ]; then
        echo "https://animuslex.app/" >> "$REAL"
    else
        echo "https://animuslex.app/$f" >> "$REAL"
    fi
done

# Articulos blog (SOLO los tracked en git — los untracked son drafts no deployados)
for d in blog/*/; do
    name=$(basename "$d")
    [ -f "$d/index.html" ] || continue
    # Skip si el index.html del articulo no esta tracked (es un draft)
    git ls-files --error-unmatch "$d/index.html" >/dev/null 2>&1 || continue
    echo "https://animuslex.app/blog/$name/" >> "$REAL"
done

# blog/ index
echo "https://animuslex.app/blog/" >> "$REAL"

# URLs en sitemap.xml
grep -oE '<loc>[^<]+</loc>' sitemap.xml | sed 's|</loc>||;s|<loc>||' | sort -u > "$LISTED"

sort -u "$REAL" -o "$REAL"
comm -23 "$REAL" "$LISTED" > "$MISSING"

if [ -s "$MISSING" ]; then
    echo "❌ URLs en disco pero NO en sitemap.xml:"
    cat "$MISSING" | sed 's/^/  - /'
    exit 1
else
    echo "✓ Todas las paginas/articulos del fs estan en sitemap.xml"
    exit 0
fi
