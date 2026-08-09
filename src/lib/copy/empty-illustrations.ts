/**
 * Écrans vides de GeniusFiles.
 *
 * Un seul endroit décrit les titres et descriptions des états vides et
 * d'erreur. Rien n'est écrit en dur dans les composants : la couche UI
 * reçoit uniquement un identifiant d'état et les chaînes sont résolues
 * ici, dans la langue active de l'appareil.
 *
 * Ajouter une langue = ajouter une entrée dans `STRINGS`. Aucun autre
 * fichier à toucher.
 */

/** États vides disponibles. */
export type EmptyIllustrationId =
  | "files"
  | "documents"
  | "images"
  | "videos"
  | "audio"
  | "downloads"
  | "favorites"
  | "trash"
  | "search"
  | "folder"
  | "storage"
  | "permission"
  | "network"
  | "notFound"
  | "openFailed"
  | "lowSpace"
  | "unknownError"
  | "operationFailed";

type Entry = { title: string; description: string };
type Bundle = Record<EmptyIllustrationId, Entry>;

const FR: Bundle = {
  files: {
    title: "Aucun fichier",
    description: "Il n'y a rien à afficher ici pour le moment.",
  },
  documents: {
    title: "Aucun document",
    description: "Vos documents apparaîtront ici dès qu'il y en aura.",
  },
  images: {
    title: "Aucune image",
    description: "Vos photos et images apparaîtront ici.",
  },
  videos: {
    title: "Aucune vidéo",
    description: "Vos vidéos apparaîtront ici dès qu'il y en aura.",
  },
  audio: {
    title: "Aucune musique",
    description: "Vos musiques et enregistrements apparaîtront ici.",
  },
  downloads: {
    title: "Aucun téléchargement",
    description: "Les fichiers que vous téléchargez apparaîtront ici.",
  },
  favorites: {
    title: "Aucun favori",
    description: "Marquez un fichier d'une étoile pour le retrouver ici.",
  },
  trash: {
    title: "Corbeille vide",
    description: "Les éléments supprimés apparaîtront ici avant leur effacement définitif.",
  },
  search: {
    title: "Aucun résultat",
    description: "Essayez un autre mot-clé ou ajustez vos filtres.",
  },
  folder: {
    title: "Dossier vide",
    description: "Ce dossier ne contient encore aucun élément.",
  },
  storage: {
    title: "Stockage inaccessible",
    description: "Impossible d'accéder à cet emplacement de stockage.",
  },
  permission: {
    title: "Permission refusée",
    description: "Autorisez GeniusFiles à accéder à vos fichiers.",
  },
  network: {
    title: "Erreur réseau",
    description: "Vérifiez votre connexion Internet puis réessayez.",
  },
  notFound: {
    title: "Fichier introuvable",
    description: "Ce fichier n'existe plus ou a été déplacé.",
  },
  openFailed: {
    title: "Ouverture impossible",
    description: "Impossible d'ouvrir ce fichier.",
  },
  lowSpace: {
    title: "Mémoire insuffisante",
    description:
      "L'espace disponible est insuffisant pour terminer cette opération. Libérez de l'espace puis réessayez.",
  },
  unknownError: {
    title: "Erreur inconnue",
    description: "Une erreur inattendue s'est produite. Veuillez réessayer dans quelques instants.",
  },
  operationFailed: {
    title: "Échec de l'opération",
    description:
      "L'action demandée n'a pas pu être exécutée. Vérifiez les informations puis réessayez.",
  },
};

const EN: Bundle = {
  files: {
    title: "No files",
    description: "There is nothing to show here yet.",
  },
  documents: {
    title: "No documents",
    description: "Your documents will show up here.",
  },
  images: {
    title: "No images",
    description: "Your photos and images will show up here.",
  },
  videos: {
    title: "No videos",
    description: "Your videos will show up here.",
  },
  audio: {
    title: "No music",
    description: "Your music and recordings will show up here.",
  },
  downloads: {
    title: "No downloads",
    description: "Files you download will show up here.",
  },
  favorites: {
    title: "No favourites",
    description: "Star a file to find it here.",
  },
  trash: {
    title: "Trash is empty",
    description: "Deleted items appear here before being erased for good.",
  },
  search: {
    title: "No results",
    description: "Try another keyword or adjust your filters.",
  },
  folder: {
    title: "Empty folder",
    description: "This folder does not contain anything yet.",
  },
  storage: {
    title: "Storage unavailable",
    description: "This storage location can't be reached.",
  },
  permission: {
    title: "Permission denied",
    description: "Allow GeniusFiles to access your files.",
  },
  network: {
    title: "Network error",
    description: "Check your Internet connection and try again.",
  },
  notFound: {
    title: "File not found",
    description: "This file no longer exists or has been moved.",
  },
  openFailed: {
    title: "Can't open",
    description: "This file could not be opened.",
  },
  lowSpace: {
    title: "Not enough storage",
    description:
      "There isn't enough free space to finish this operation. Free up some space, then try again.",
  },
  unknownError: {
    title: "Unknown error",
    description: "Something unexpected happened. Please try again in a moment.",
  },
  operationFailed: {
    title: "Operation failed",
    description: "The requested action could not be completed. Check the details, then try again.",
  },
};

const ES: Bundle = {
  files: {
    title: "Ningún archivo",
    description: "Aquí todavía no hay nada que mostrar.",
  },
  documents: {
    title: "Ningún documento",
    description: "Tus documentos aparecerán aquí.",
  },
  images: {
    title: "Ninguna imagen",
    description: "Tus fotos e imágenes aparecerán aquí.",
  },
  videos: {
    title: "Ningún vídeo",
    description: "Tus vídeos aparecerán aquí.",
  },
  audio: {
    title: "Ninguna música",
    description: "Tu música y grabaciones aparecerán aquí.",
  },
  downloads: {
    title: "Ninguna descarga",
    description: "Los archivos que descargues aparecerán aquí.",
  },
  favorites: {
    title: "Ningún favorito",
    description: "Marca un archivo con una estrella para encontrarlo aquí.",
  },
  trash: {
    title: "Papelera vacía",
    description: "Los elementos eliminados aparecen aquí antes de borrarse definitivamente.",
  },
  search: {
    title: "Ningún resultado",
    description: "Prueba otra palabra clave o ajusta los filtros.",
  },
  folder: {
    title: "Carpeta vacía",
    description: "Esta carpeta todavía no contiene nada.",
  },
  storage: {
    title: "Almacenamiento inaccesible",
    description: "No se puede acceder a esta ubicación de almacenamiento.",
  },
  permission: {
    title: "Permiso denegado",
    description: "Permite que GeniusFiles acceda a tus archivos.",
  },
  network: {
    title: "Error de red",
    description: "Comprueba tu conexión a Internet e inténtalo de nuevo.",
  },
  notFound: {
    title: "Archivo no encontrado",
    description: "Este archivo ya no existe o se ha movido.",
  },
  openFailed: {
    title: "No se puede abrir",
    description: "No se ha podido abrir este archivo.",
  },
  lowSpace: {
    title: "Espacio insuficiente",
    description:
      "No hay suficiente espacio libre para completar esta operación. Libera espacio e inténtalo de nuevo.",
  },
  unknownError: {
    title: "Error desconocido",
    description: "Se ha producido un error inesperado. Inténtalo de nuevo en unos instantes.",
  },
  operationFailed: {
    title: "Operación fallida",
    description:
      "No se ha podido completar la acción solicitada. Comprueba los datos e inténtalo de nuevo.",
  },
};

const PT: Bundle = {
  files: {
    title: "Nenhum ficheiro",
    description: "Ainda não há nada para mostrar aqui.",
  },
  documents: {
    title: "Nenhum documento",
    description: "Os seus documentos aparecerão aqui.",
  },
  images: {
    title: "Nenhuma imagem",
    description: "As suas fotos e imagens aparecerão aqui.",
  },
  videos: {
    title: "Nenhum vídeo",
    description: "Os seus vídeos aparecerão aqui.",
  },
  audio: {
    title: "Nenhuma música",
    description: "As suas músicas e gravações aparecerão aqui.",
  },
  downloads: {
    title: "Nenhum download",
    description: "Os ficheiros que transferir aparecerão aqui.",
  },
  favorites: {
    title: "Nenhum favorito",
    description: "Marque um ficheiro com uma estrela para o encontrar aqui.",
  },
  trash: {
    title: "Reciclagem vazia",
    description: "Os itens eliminados aparecem aqui antes de serem apagados definitivamente.",
  },
  search: {
    title: "Nenhum resultado",
    description: "Tente outra palavra-chave ou ajuste os filtros.",
  },
  folder: {
    title: "Pasta vazia",
    description: "Esta pasta ainda não contém nada.",
  },
  storage: {
    title: "Armazenamento inacessível",
    description: "Não é possível acessar este local de armazenamento.",
  },
  permission: {
    title: "Permissão recusada",
    description: "Autorize o GeniusFiles a acessar os seus ficheiros.",
  },
  network: {
    title: "Erro de rede",
    description: "Verifique a sua ligação à Internet e tente novamente.",
  },
  notFound: {
    title: "Ficheiro não encontrado",
    description: "Este ficheiro já não existe ou foi movido.",
  },
  openFailed: {
    title: "Não foi possível abrir",
    description: "Não foi possível abrir este ficheiro.",
  },
  lowSpace: {
    title: "Espaço insuficiente",
    description:
      "Não há espaço livre suficiente para concluir esta operação. Liberte espaço e tente novamente.",
  },
  unknownError: {
    title: "Erro desconhecido",
    description: "Ocorreu um erro inesperado. Tente novamente dentro de alguns instantes.",
  },
  operationFailed: {
    title: "Falha na operação",
    description:
      "Não foi possível concluir a ação solicitada. Verifique os dados e tente novamente.",
  },
};

const DE: Bundle = {
  files: {
    title: "Keine Dateien",
    description: "Hier gibt es noch nichts anzuzeigen.",
  },
  documents: {
    title: "Keine Dokumente",
    description: "Ihre Dokumente erscheinen hier.",
  },
  images: {
    title: "Keine Bilder",
    description: "Ihre Fotos und Bilder erscheinen hier.",
  },
  videos: {
    title: "Keine Videos",
    description: "Ihre Videos erscheinen hier.",
  },
  audio: {
    title: "Keine Musik",
    description: "Ihre Musik und Aufnahmen erscheinen hier.",
  },
  downloads: {
    title: "Keine Downloads",
    description: "Heruntergeladene Dateien erscheinen hier.",
  },
  favorites: {
    title: "Keine Favoriten",
    description: "Markieren Sie eine Datei mit einem Stern, um sie hier zu finden.",
  },
  trash: {
    title: "Papierkorb ist leer",
    description: "Gelöschte Elemente erscheinen hier, bevor sie endgültig entfernt werden.",
  },
  search: {
    title: "Keine Ergebnisse",
    description: "Versuchen Sie ein anderes Stichwort oder passen Sie die Filter an.",
  },
  folder: {
    title: "Leerer Ordner",
    description: "Dieser Ordner enthält noch nichts.",
  },
  storage: {
    title: "Speicher nicht erreichbar",
    description: "Auf diesen Speicherort kann nicht zugegriffen werden.",
  },
  permission: {
    title: "Zugriff verweigert",
    description: "Erlauben Sie GeniusFiles den Zugriff auf Ihre Dateien.",
  },
  network: {
    title: "Netzwerkfehler",
    description: "Prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.",
  },
  notFound: {
    title: "Datei nicht gefunden",
    description: "Diese Datei existiert nicht mehr oder wurde verschoben.",
  },
  openFailed: {
    title: "Öffnen nicht möglich",
    description: "Diese Datei konnte nicht geöffnet werden.",
  },
  lowSpace: {
    title: "Speicher voll",
    description:
      "Es ist nicht genügend freier Speicher vorhanden, um diesen Vorgang abzuschließen. Schaffe Platz und versuche es erneut.",
  },
  unknownError: {
    title: "Unbekannter Fehler",
    description:
      "Es ist ein unerwarteter Fehler aufgetreten. Bitte versuche es in einem Moment erneut.",
  },
  operationFailed: {
    title: "Vorgang fehlgeschlagen",
    description:
      "Die gewünschte Aktion konnte nicht ausgeführt werden. Prüfe die Angaben und versuche es erneut.",
  },
};

const IT: Bundle = {
  files: {
    title: "Nessun file",
    description: "Qui non c'è ancora nulla da mostrare.",
  },
  documents: {
    title: "Nessun documento",
    description: "I tuoi documenti compariranno qui.",
  },
  images: {
    title: "Nessuna immagine",
    description: "Le tue foto e immagini compariranno qui.",
  },
  videos: {
    title: "Nessun video",
    description: "I tuoi video compariranno qui.",
  },
  audio: {
    title: "Nessuna musica",
    description: "La tua musica e le registrazioni compariranno qui.",
  },
  downloads: {
    title: "Nessun download",
    description: "I file che scarichi compariranno qui.",
  },
  favorites: {
    title: "Nessun preferito",
    description: "Aggiungi una stella a un file per ritrovarlo qui.",
  },
  trash: {
    title: "Cestino vuoto",
    description: "Gli elementi eliminati compaiono qui prima di essere rimossi definitivamente.",
  },
  search: {
    title: "Nessun risultato",
    description: "Prova un'altra parola chiave o modifica i filtri.",
  },
  folder: {
    title: "Cartella vuota",
    description: "Questa cartella non contiene ancora nulla.",
  },
  storage: {
    title: "Archiviazione inaccessibile",
    description: "Impossibile accedere a questa posizione di archiviazione.",
  },
  permission: {
    title: "Autorizzazione negata",
    description: "Consenti a GeniusFiles di accedere ai tuoi file.",
  },
  network: {
    title: "Errore di rete",
    description: "Controlla la connessione Internet e riprova.",
  },
  notFound: {
    title: "File non trovato",
    description: "Questo file non esiste più o è stato spostato.",
  },
  openFailed: {
    title: "Apertura impossibile",
    description: "Impossibile aprire questo file.",
  },
  lowSpace: {
    title: "Spazio insufficiente",
    description:
      "Lo spazio disponibile non è sufficiente per completare questa operazione. Libera spazio e riprova.",
  },
  unknownError: {
    title: "Errore sconosciuto",
    description: "Si è verificato un errore inatteso. Riprova tra qualche istante.",
  },
  operationFailed: {
    title: "Operazione non riuscita",
    description: "L'azione richiesta non è stata completata. Verifica i dati e riprova.",
  },
};

const AR: Bundle = {
  files: {
    title: "لا توجد ملفات",
    description: "لا يوجد شيء لعرضه هنا بعد.",
  },
  documents: {
    title: "لا توجد مستندات",
    description: "ستظهر مستنداتك هنا.",
  },
  images: {
    title: "لا توجد صور",
    description: "ستظهر صورك هنا.",
  },
  videos: {
    title: "لا توجد فيديوهات",
    description: "ستظهر مقاطع الفيديو هنا.",
  },
  audio: {
    title: "لا توجد موسيقى",
    description: "ستظهر موسيقاك وتسجيلاتك هنا.",
  },
  downloads: {
    title: "لا توجد تنزيلات",
    description: "ستظهر الملفات التي تنزّلها هنا.",
  },
  favorites: {
    title: "لا توجد مفضلات",
    description: "أضف نجمة إلى ملف لتجده هنا.",
  },
  trash: {
    title: "سلة المحذوفات فارغة",
    description: "تظهر العناصر المحذوفة هنا قبل حذفها نهائيًا.",
  },
  search: {
    title: "لا توجد نتائج",
    description: "جرّب كلمة أخرى أو عدّل عوامل التصفية.",
  },
  folder: {
    title: "مجلد فارغ",
    description: "لا يحتوي هذا المجلد على أي عنصر بعد.",
  },
  storage: {
    title: "وحدة التخزين غير متاحة",
    description: "لا يمكن الوصول إلى موقع التخزين هذا.",
  },
  permission: {
    title: "تم رفض الإذن",
    description: "اسمح لتطبيق GeniusFiles بالوصول إلى ملفاتك.",
  },
  network: {
    title: "خطأ في الشبكة",
    description: "تحقّق من اتصالك بالإنترنت ثم أعد المحاولة.",
  },
  notFound: {
    title: "الملف غير موجود",
    description: "هذا الملف لم يعد موجودًا أو تم نقله.",
  },
  openFailed: {
    title: "تعذّر الفتح",
    description: "تعذّر فتح هذا الملف.",
  },
  lowSpace: {
    title: "مساحة التخزين غير كافية",
    description: "لا تتوفر مساحة كافية لإكمال هذه العملية. حرّر بعض المساحة ثم أعد المحاولة.",
  },
  unknownError: {
    title: "خطأ غير معروف",
    description: "حدث خطأ غير متوقع. يُرجى إعادة المحاولة بعد لحظات.",
  },
  operationFailed: {
    title: "تعذّر إتمام العملية",
    description: "لم يتم تنفيذ الإجراء المطلوب. تحقّق من المعلومات ثم أعد المحاولة.",
  },
};

const STRINGS: Record<string, Bundle> = {
  fr: FR,
  en: EN,
  es: ES,
  pt: PT,
  de: DE,
  it: IT,
  ar: AR,
};

/** Langue active de l'appareil, repliée sur le français par défaut. */
function activeLanguage(): string {
  // Côté serveur, `navigator` existe mais décrit le runtime, pas
  // l'utilisateur : on ne lit la langue que dans le navigateur.
  if (typeof window === "undefined") return "fr";
  const tags = [document.documentElement.lang, navigator.language, ...(navigator.languages ?? [])];
  for (const tag of tags) {
    const base = (tag ?? "").slice(0, 2).toLowerCase();
    if (base && STRINGS[base]) return base;
  }
  return "fr";
}

/** Titre et description d'un état vide. */
export function emptyIllustrationCopy(id: EmptyIllustrationId): Entry {
  const bundle = STRINGS[activeLanguage()] ?? FR;
  return bundle[id] ?? FR[id];
}

/** Libellés des actions proposées sous un état illustré. */
export type EmptyActionId = "retry" | "allow" | "back" | "openWith" | "freeSpace";

const ACTIONS: Record<string, Record<EmptyActionId, string>> = {
  fr: {
    retry: "Réessayer",
    allow: "Autoriser",
    back: "Retour",
    openWith: "Choisir une autre application",
    freeSpace: "Libérer de l'espace",
  },
  en: {
    retry: "Try again",
    allow: "Allow",
    back: "Back",
    openWith: "Choose another app",
    freeSpace: "Free up space",
  },
  es: {
    retry: "Reintentar",
    allow: "Permitir",
    back: "Volver",
    openWith: "Elegir otra aplicación",
    freeSpace: "Liberar espacio",
  },
  pt: {
    retry: "Tentar novamente",
    allow: "Autorizar",
    back: "Voltar",
    openWith: "Escolher outra aplicação",
    freeSpace: "Libertar espaço",
  },
  de: {
    retry: "Erneut versuchen",
    allow: "Erlauben",
    back: "Zurück",
    openWith: "Andere App wählen",
    freeSpace: "Speicher freigeben",
  },
  it: {
    retry: "Riprova",
    allow: "Consenti",
    back: "Indietro",
    openWith: "Scegli un'altra app",
    freeSpace: "Libera spazio",
  },
  ar: {
    retry: "إعادة المحاولة",
    allow: "السماح",
    back: "رجوع",
    openWith: "اختيار تطبيق آخر",
    freeSpace: "تحرير مساحة",
  },
};

/** Libellé localisé d'une action d'état illustré. */
export function emptyActionLabel(id: EmptyActionId): string {
  const bundle = ACTIONS[activeLanguage()] ?? ACTIONS["fr"]!;
  return bundle[id];
}

/**
 * État « hors connexion » du module de chat.
 */
export type ChatOfflineCopy = { title: string; description: string; retry: string };

const CHAT_OFFLINE: Record<string, ChatOfflineCopy> = {
  fr: {
    title: "Aucune connexion Internet",
    description:
      "Impossible d'envoyer votre message pour le moment. Vérifiez votre connexion puis réessayez.",
    retry: "Réessayer",
  },
  en: {
    title: "No Internet connection",
    description: "Your message can't be sent right now. Check your connection, then try again.",
    retry: "Try again",
  },
  es: {
    title: "Sin conexión a Internet",
    description:
      "No se puede enviar tu mensaje en este momento. Comprueba tu conexión e inténtalo de nuevo.",
    retry: "Reintentar",
  },
  pt: {
    title: "Sem ligação à Internet",
    description:
      "Não é possível enviar a sua mensagem neste momento. Verifique a ligação e tente novamente.",
    retry: "Tentar novamente",
  },
  de: {
    title: "Keine Internetverbindung",
    description:
      "Ihre Nachricht kann derzeit nicht gesendet werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
    retry: "Erneut versuchen",
  },
  it: {
    title: "Nessuna connessione a Internet",
    description:
      "Impossibile inviare il messaggio in questo momento. Controlla la connessione e riprova.",
    retry: "Riprova",
  },
  ar: {
    title: "لا يوجد اتصال بالإنترنت",
    description: "تعذّر إرسال رسالتك الآن. تحقق من اتصالك ثم أعد المحاولة.",
    retry: "إعادة المحاولة",
  },
};

/** Chaînes localisées de l'état hors connexion du chat. */
export function chatOfflineCopy(): ChatOfflineCopy {
  return CHAT_OFFLINE[activeLanguage()] ?? CHAT_OFFLINE["fr"]!;
}
