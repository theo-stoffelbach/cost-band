# cost-band

Mod Claude Code : une bande au-dessus du prompt qui affiche

```
$0.052 / $4.99 (0%/15%) 45.2k tokens     7m03s | 1h52m16s (63% | 18%)
```

- **À gauche** : coût du dernier message / coût de la session (part de la limite 5 h consommée par le dernier message / par la session), puis les tokens de la conversation
- **À droite** : temps de travail de Claude | durée d'ouverture de la session (limite 5 h restante | limite hebdo restante)

Les valeurs passent à l'orange puis au rouge au-delà des seuils définis dans `THRESHOLDS` (`hooks/register.tsx`).

## Installation

Dans un terminal Claude Code :

```
/plugin install cost-band --marketplace theo-stoffelbach/cost-band
```

Répondre `y` pour ajouter le marketplace, puis valider la portée « user ».
