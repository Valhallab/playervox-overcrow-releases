# MCP

PlayerVox OverCrow a un serveur pour les assistants IA : `@overcrow/mcp`.
Ajoutez-le à Claude Code, Claude Desktop, Cursor, VS Code ou Codex, et votre
assistant peut créer un widget, le vérifier, le tester, l’auditer,
l’empaqueter et préparer sa soumission. Il vous faut Node.js 22.18 ou plus
récent, rien d’autre : le serveur installe lui-même les outils OverCrow dont
il a besoin.

```sh
claude mcp add overcrow -- npx -y @overcrow/mcp
```

Demandez ensuite : « Crée un widget OverCrow qui affiche… ».

## Ajouter le serveur

Ouvrez votre dossier de widgets dans l’assistant, puis ajoutez le serveur.

### En une commande

**Claude Code**, depuis ce dossier :

```sh
claude mcp add overcrow -- npx -y @overcrow/mcp
```

**Codex** :

```sh
codex mcp add overcrow -- npx -y @overcrow/mcp
```

**VS Code** : [installer dans VS Code](https://insiders.vscode.dev/redirect?url=vscode%3Amcp%2Finstall%3F%257B%2522name%2522%253A%2522overcrow%2522%252C%2522command%2522%253A%2522npx%2522%252C%2522args%2522%253A%255B%2522-y%2522%252C%2522%2540overcrow%252Fmcp%2522%255D%257D), ou :

```sh
code --add-mcp '{"name":"overcrow","command":"npx","args":["-y","@overcrow/mcp"]}'
```

### Avec un fichier de configuration

**Cursor** : un fichier `.cursor/mcp.json` dans le dossier.

<!-- source: mcp/examples/cursor-mcp.json -->
```json
{
  "mcpServers": {
    "overcrow": {
      "command": "npx",
      "args": ["-y", "@overcrow/mcp"]
    }
  }
}
```

**VS Code** : un fichier `.vscode/mcp.json` dans le dossier.

<!-- source: mcp/examples/vscode-mcp.json -->
```json
{
  "servers": {
    "overcrow": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@overcrow/mcp"]
    }
  }
}
```

**Claude Desktop** lance ses serveurs hors de vos dossiers : indiquez votre
dossier de widgets avec `--root` dans `claude_desktop_config.json`
(Paramètres, Développeur, Modifier la configuration), puis redémarrez
Claude Desktop.

<!-- source: mcp/examples/claude_desktop_config.json -->
```json
{
  "mcpServers": {
    "overcrow": {
      "command": "npx",
      "args": ["-y", "@overcrow/mcp", "--root", "C:\\Users\\you\\Documents\\widgets"]
    }
  }
}
```

## Ce que fait le serveur

- **La première fois**, il télécharge les outils créateurs OverCrow de
  votre ordinateur ([l’outil en ligne de commande](cli.md) et le runtime
  qui joue les [tests](testing.md), environ 15 Mo) depuis la release GitHub
  d’OverCrow. Il vérifie chaque fichier avec les empreintes inscrites dans
  le serveur, puis les garde dans son propre dossier
  (`~/.cache/overcrow-mcp`, ou `%LOCALAPPDATA%\overcrow-mcp` sous Windows).
  Rien ne s’ajoute à votre `PATH`, et aucun droit d’administrateur n’est
  nécessaire.
- **Ensuite**, votre assistant travaille avec ses outils, dans cet ordre :
  créer le widget depuis un modèle, installer le SDK (il vous le demande
  d’abord), vérifier, tester (il voit les images qui diffèrent), auditer,
  empaqueter, préparer la soumission.
- **L’identifiant du widget** est définitif. Votre assistant vous le
  demande : votre pseudo d’éditeur dans l’espace créateurs d’OverCrow et un
  nom (`valhallab.lol-timers`), ou un domaine que vous pouvez vérifier
  (`gg.valhallab.lol-timers`).
- **La soumission** : le serveur vérifie tout ce que demande l’espace
  créateurs, puis écrit le zip des sources de votre widget dans `dist/`,
  sans `node_modules`, `dist`, fichiers cachés ni clés, et liste ce qu’il a
  laissé de côté. Il liste aussi les textes à écrire : pourquoi le widget a
  besoin de chaque permission, les notes de version et la description en
  français et en anglais. Votre assistant les rédige avec vous.
- **L’audit** note le widget sur 100 pour la sécurité et pour la légèreté,
  avec pour chaque constat une correction et un exemple tiré d’un
  [widget de référence](widgets.md) : permissions inutilisées, règles
  réseau trop larges, secrets, écritures dans le presse-papiers sans action
  de l’utilisateur, minuteurs rapides, interrogation répétée du réseau,
  listes qui grandissent sans fin, grosses réponses lues en un seul tour,
  images lourdes.
- **La documentation** de ce site, en français et en anglais, et les
  sources des widgets de référence viennent avec le serveur : votre
  assistant les lit sans accès au réseau.

## Ce qu’il ne fait pas

- Il n’envoie, ne signe et ne publie jamais rien. Vous envoyez le zip et
  les textes dans l’espace créateurs d’OverCrow, sur overcrow.playervox.com.
- Il n’installe pas votre widget dans OverCrow : l’essayer en jeu passe par
  le [canal de développement](dev-channel.md) de l’outil en ligne de
  commande.
- Il n’envoie rien sur vous : ni télémétrie, ni compte.

## Sécurité

- **Vos dossiers seulement.** Le serveur travaille dans le dossier ouvert
  dans votre assistant (ou ceux donnés avec `--root`). Il refuse un dossier
  système, votre dossier personnel entier, les dossiers cachés et les liens
  qui mènent ailleurs.
- **Aucune commande de son choix.** Le serveur lance l’outil en ligne de
  commande d’OverCrow et npm, rien d’autre, jamais à travers un shell.
- **Téléchargements vérifiés.** Il ne télécharge que les fichiers épinglés
  depuis GitHub, et les vérifie avant de s’en servir. npm n’installe que
  `@overcrow/sdk` et TypeScript, sans scripts d’installation, et leur
  intégrité est comparée à celle des paquets publiés.
- **Vous confirmez.** Installer des paquets et remplacer des images de
  référence demandent votre accord.
- **Vos fichiers sont des données.** Ce que les outils renvoient de vos
  fichiers est marqué comme donnée : un texte placé dans un widget ne peut
  pas donner d’ordres à votre assistant par le serveur. Relisez tout de même
  ce que votre assistant modifie, et validez ses actions comme d’habitude.

## Hors ligne

Téléchargez une fois depuis la release GitHub d’OverCrow le fichier
`overcrow-creator-tools-VERSION-PLATFORME.zip` de votre plateforme,
placez-le dans votre dossier de widgets, et demandez à votre assistant de
lancer `setup` avec ce fichier (`zipPath`). Ou lancez le serveur avec
`--tools-zip` et le chemin du fichier. Le fichier doit être exactement celui
que le serveur épingle.

## Ordinateurs pris en charge

Vérifier, tester et empaqueter demandent Windows x64 ou Linux x86-64. Sous
macOS et sur ARM, le serveur donne quand même la documentation, les
explications et l’audit.

## En cas de problème

- **« not tied to a published OverCrow release »** : mettez le serveur à
  jour avec `npx -y @overcrow/mcp@latest`.
- **Derrière un proxy** : définissez `HTTPS_PROXY` dans l’environnement du
  serveur.
- **« cannot work in / »** (souvent Claude Desktop) : ajoutez `--root` et
  votre dossier de widgets.
