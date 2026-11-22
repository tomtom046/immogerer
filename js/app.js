import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged, GoogleAuthProvider, linkWithPopup, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, collection, addDoc, updateDoc, deleteDoc, onSnapshot, writeBatch } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// VOS IDENTIFIANTS FIREBASE
const firebaseConfig = {
    apiKey: "AIzaSyAkyn328IQyfZmZq46xGlGz_9TAPUjuQGk",
    authDomain: "suivie-apartement.firebaseapp.com",
    projectId: "suivie-apartement",
    storageBucket: "suivie-apartement.firebasestorage.app",
    messagingSenderId: "923503403552",
    appId: "1:923503403552:web:39e3d6f5c1337d6c645245"
};

const appIdentifier = 'app-gestion-locative';

let app, auth, db, currentUser;
let unsubscribeTransactions = null;
let allTransactions = []; 
let appSettings = {}; 
let gmailToken = null; 

const fields = [
    'bailleur_nom', 'bailleur_adresse', 'locataire_nom', 'locataire_email',
    'logement_adresse', 'loyer_base', 'loyer_charges', 'lieu_emission',
    'caution', 'prix_achat', 'credit_mensualite', 'credit_debut', 'google_client_id'
];
let currentSignatureData = '';
let financeChartInstance = null; 
let calendarInstance = null;

// Modale de sécurité
let currentConfirmAction = null;
window.showConfirmModal = function(title, text, preview, onConfirm) {
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-text').innerHTML = text;
    document.getElementById('modal-preview').innerHTML = preview;
    currentConfirmAction = onConfirm;
    document.getElementById('email-confirm-modal').classList.remove('hidden');
};
window.closeConfirmModal = function() {
    document.getElementById('email-confirm-modal').classList.add('hidden');
    currentConfirmAction = null;
};
document.getElementById('modal-cancel').addEventListener('click', closeConfirmModal);
document.getElementById('modal-confirm').addEventListener('click', () => {
    if (currentConfirmAction) currentConfirmAction();
    closeConfirmModal();
});

// Initialisation de l'interface
const now = new Date();
const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
document.getElementById('date_debut').value = currentMonth;
document.getElementById('date_fin').value = currentMonth;
document.getElementById('trans_date').valueAsDate = new Date();
document.getElementById('reg_year').value = now.getFullYear();

window.switchTab = function(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
        el.classList.remove('flex', 'block');
    });
    document.querySelectorAll('.tab-btn').forEach(el => {
        el.classList.remove('active', 'bg-blue-600', 'text-white');
        el.classList.add('text-slate-300');
    });
    
    const targetTab = document.getElementById('tab-' + tabId);
    targetTab.classList.remove('hidden');
    if (tabId === 'calendrier') targetTab.classList.add('flex');
    else targetTab.classList.add('block');
    
    const btn = document.getElementById('nav-' + tabId);
    btn.classList.add('active', 'bg-blue-600', 'text-white');
    btn.classList.remove('text-slate-300');

    // Barre du bas (mobile) : les onglets absents de la barre activent "Plus"
    document.querySelectorAll('.mnav-btn').forEach(el => el.classList.remove('active'));
    (document.getElementById('mnav-' + tabId) || document.getElementById('mnav-more')).classList.add('active');
    closeSidebar();
    document.querySelector('main').scrollTop = 0;

    if(tabId === 'regularisation') calculateRegularization();
    if(tabId === 'calendrier') setTimeout(initOrUpdateCalendar, 50);
};

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
} catch (error) {
    console.error("Erreur Firebase:", error);
    showToast("Erreur de configuration Cloud", true);
}

const initAuth = async () => {
    try { await signInAnonymously(auth); } catch (e) {
        document.getElementById('connection-status').innerHTML = `<i class="fa-solid fa-triangle-exclamation text-red-500"></i> Erreur`;
    }
};

function updateAccountUI(user) {
    const isAnon = !user || user.isAnonymous;
    const status = document.getElementById('connection-status');
    if (user && !isAnon) {
        status.innerHTML = `<i class="fa-solid fa-cloud text-green-400"></i> ${escapeHtml(user.email || 'Compte Google')}`;
    } else if (user) {
        status.innerHTML = `<i class="fa-solid fa-cloud text-amber-400"></i> Sauvegarde active (anonyme)`;
    }
    document.getElementById('account-warning').classList.toggle('hidden', !isAnon);
    document.getElementById('btn-google-login').classList.toggle('hidden', !isAnon);
    document.getElementById('btn-logout').classList.toggle('hidden', isAnon);
    const mIcon = document.getElementById('mobile-account-icon');
    if (mIcon) mIcon.className = `fa-solid ${isAnon ? 'fa-circle-exclamation text-amber-400' : 'fa-circle-user text-green-400'} text-xl`;
}

// --- MENU TIROIR (mobile) ---
window.openSidebar = function() {
    document.getElementById('sidebar').classList.add('open');
    document.getElementById('sidebar-overlay').classList.remove('hidden');
};
window.closeSidebar = function() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.add('hidden');
};

// --- INSTALLATION (PWA) ---
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('Service worker non enregistré :', err));
}
let deferredInstallPrompt = null;
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    document.getElementById('btn-install').classList.remove('hidden');
});
window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.getElementById('btn-install').classList.add('hidden');
    showToast("Application installée !");
});
// Sur iPhone/iPad, il n'y a pas d'invite automatique : on affiche le bouton pour expliquer la marche à suivre
if (isIOS && !isStandalone) document.getElementById('btn-install').classList.remove('hidden');

window.installApp = async function() {
    if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
    } else if (isIOS) {
        alert("Pour installer ImmoGérer sur iPhone / iPad :\n\n1. Ouvrez ce site dans Safari\n2. Touchez le bouton Partager (carré avec une flèche)\n3. Choisissez « Sur l'écran d'accueil »\n4. Touchez « Ajouter »");
    } else {
        alert("Pour installer ImmoGérer : ouvrez le menu du navigateur (⋮) puis « Installer l'application » ou « Ajouter à l'écran d'accueil ».");
    }
};

// Lie le compte anonyme actuel à Google (garde le même identifiant => aucune donnée perdue).
// Si ce compte Google est déjà lié ailleurs, on se connecte simplement dessus.
window.linkGoogleAccount = async function() {
    const provider = new GoogleAuthProvider();
    try {
        if (auth.currentUser && auth.currentUser.isAnonymous) {
            await linkWithPopup(auth.currentUser, provider);
            showToast("Compte sécurisé avec Google ! Vos données sont conservées.");
        } else {
            await signInWithPopup(auth, provider);
        }
        updateAccountUI(auth.currentUser);
    } catch (e) {
        if (e.code === 'auth/credential-already-in-use') {
            if (!confirm("Ce compte Google possède déjà des données. Basculer dessus ? (les données du compte anonyme actuel ne seront plus visibles — exportez-les d'abord en JSON si besoin)")) return;
            try { await signInWithPopup(auth, provider); showToast("Connecté avec Google."); }
            catch (e2) { showToast("Connexion Google impossible : " + e2.code, true); }
        } else if (e.code === 'auth/operation-not-allowed') {
            showToast("Activez le fournisseur Google dans la console Firebase (Authentication > Sign-in method).", true);
        } else if (e.code !== 'auth/popup-closed-by-user') {
            showToast("Connexion Google impossible : " + e.code, true);
        }
    }
};

window.logout = async function() {
    if (!confirm("Se déconnecter ? Vous pourrez vous reconnecter avec Google pour retrouver vos données.")) return;
    await signOut(auth);
};

if (auth) {
    onAuthStateChanged(auth, async (user) => {
        if (unsubscribeTransactions) { unsubscribeTransactions(); unsubscribeTransactions = null; }
        if (user) {
            currentUser = user;
            updateAccountUI(user);
            enableForm();
            await loadDataFromCloud();
            setupTransactionsListener();
        } else {
            currentUser = null;
            allTransactions = [];
            initAuth(); // aucune session : on repart sur un compte anonyme
        }
    });
}

// --- GESTION CATÉGORIES ---
const defaultCategories = [
    { value: 'loyer', label: 'Loyer perçu (Locataire)' },
    { value: 'charge', label: 'Charge récupérable (ex: Eau, TEOM)' },
    { value: 'charge_immo', label: 'Charge Immobilière globale' },
    { value: 'taxe_fonciere', label: 'Taxe foncière' },
    { value: 'csg', label: 'CSG' },
    { value: 'depense', label: 'Dépense proprio (Assurance, frais)' },
    { value: 'travaux', label: 'Travaux / Entretien' }
];

function renderCategories() {
    const select = document.getElementById('trans_type');
    const currentValue = select.value;
    select.innerHTML = '';
    
    defaultCategories.forEach(cat => select.add(new Option(cat.label, cat.value)));

    if (appSettings.custom_categories && Array.isArray(appSettings.custom_categories)) {
        appSettings.custom_categories.forEach(cat => select.add(new Option(cat, cat)));
    }
    select.add(new Option('➕ Créer et sauvegarder une catégorie...', 'autre'));

    if(Array.from(select.options).some(opt => opt.value === currentValue)) select.value = currentValue;
    else select.value = 'loyer';
}

function enableForm() {
    fields.forEach(field => {
        const el = document.getElementById(field);
        if(el) { el.disabled = false; el.classList.remove('disabled:bg-slate-200'); }
    });
    document.getElementById('signature_file').disabled = false;
    ['btn-save', 'btn-generate', 'btn-generate-email'].forEach(id => {
        const btn = document.getElementById(id);
        if(btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
    });
}

async function loadDataFromCloud() {
    if (!currentUser) return;
    const docSnap = await getDoc(doc(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'settings', 'profile'));
    if (docSnap.exists()) {
        appSettings = docSnap.data();
        fields.forEach(field => {
            if (appSettings[field] !== undefined && document.getElementById(field)) {
                document.getElementById(field).value = appSettings[field];
            }
        });
        if (appSettings.signature_data) {
            currentSignatureData = appSettings.signature_data;
            showSignaturePreview(currentSignatureData);
        }
    }
    renderCategories();
}

async function saveDataToCloud(silent = false) {
    if (!currentUser) return;
    const btnSave = document.getElementById('btn-save');
    const originalContent = btnSave.innerHTML;
    if(!silent) { btnSave.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-2"></i> Sauvegarde...`; btnSave.disabled = true; }

    fields.forEach(field => {
        if(document.getElementById(field)) appSettings[field] = document.getElementById(field).value;
    });
    appSettings.signature_data = currentSignatureData;
    ['loyer_base', 'loyer_charges', 'caution', 'prix_achat', 'credit_mensualite'].forEach(f => {
        appSettings[f] = parseFloat(appSettings[f]) || 0;
    });

    try {
        await setDoc(doc(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'settings', 'profile'), appSettings);
        if(!silent) { showToast("Dossier sauvegardé !"); updateDashboard(); }
    } catch (error) {
        if(!silent) showToast("Erreur sauvegarde profil", true);
    } finally {
        if(!silent) { btnSave.innerHTML = originalContent; btnSave.disabled = false; }
    }
}
document.getElementById('btn-save').addEventListener('click', () => saveDataToCloud(false));

// --- GESTION FINANCES (Transactions, Edit, Duplicate, Récurrence) ---
function setupTransactionsListener() {
    if (!currentUser) return;
    const transRef = collection(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions');
    unsubscribeTransactions = onSnapshot(transRef, (snapshot) => {
        allTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        allTransactions.sort((a, b) => new Date(b.date) - new Date(a.date));
        updateDashboard();
        renderTransactionsTable();
        if(!document.getElementById('tab-regularisation').classList.contains('hidden')) calculateRegularization();
        if(!document.getElementById('tab-calendrier').classList.contains('hidden')) initOrUpdateCalendar();
    });
}

window.toggleCustomType = function() {
    const select = document.getElementById('trans_type');
    const customInput = document.getElementById('trans_type_custom');
    if(select.value === 'autre') { customInput.classList.remove('hidden'); customInput.required = true; } 
    else { customInput.classList.add('hidden'); customInput.required = false; }
}

window.editTransaction = function(id) {
    const t = allTransactions.find(x => x.id === id);
    if(!t) return;
    document.getElementById('trans_id').value = t.id;
    document.getElementById('trans_date').value = t.date;
    document.getElementById('trans_amount').value = t.amount;
    document.getElementById('trans_desc').value = t.desc;

    // Gestion des boutons radio assignés
    const assignedRadios = document.getElementsByName('trans_assigned');
    for(let radio of assignedRadios) {
        radio.checked = (radio.value === (t.assigned || 'proprietaire'));
    }

    const select = document.getElementById('trans_type');
    if(Array.from(select.options).some(opt => opt.value === t.type)) { select.value = t.type; toggleCustomType(); } 
    else { select.value = 'autre'; document.getElementById('trans_type_custom').value = t.type; toggleCustomType(); }

    document.getElementById('recurrence_section').classList.add('hidden'); 
    document.getElementById('form-trans-title').innerText = "Modifier l'opération";
    
    const btnSubmit = document.getElementById('btn-submit-trans');
    btnSubmit.innerHTML = '<i class="fa-solid fa-pen"></i> Mettre à jour';
    btnSubmit.classList.replace('bg-slate-800', 'bg-blue-600');
    btnSubmit.classList.replace('hover:bg-slate-900', 'hover:bg-blue-700');
    document.getElementById('btn-cancel-edit').classList.remove('hidden');
    document.getElementById('btn-auto-loyer').classList.add('hidden');
    
    document.getElementById('transaction-form').scrollIntoView({behavior: 'smooth'});
};

window.cancelEditTransaction = function() {
    document.getElementById('transaction-form').reset();
    document.getElementById('trans_id').value = '';
    document.getElementById('trans_date').valueAsDate = new Date();
    document.querySelector('input[name="trans_assigned"][value="proprietaire"]').checked = true; // Remise à zéro assignation
    toggleCustomType();
    
    document.getElementById('recurrence_section').classList.remove('hidden');
    document.getElementById('recurrence_months_container').classList.add('hidden');
    document.getElementById('form-trans-title').innerText = "Saisir une opération manuelle";

    const btnSubmit = document.getElementById('btn-submit-trans');
    btnSubmit.innerHTML = '<i class="fa-solid fa-plus"></i> Ajouter';
    btnSubmit.classList.replace('bg-blue-600', 'bg-slate-800');
    btnSubmit.classList.replace('hover:bg-blue-700', 'hover:bg-slate-900');
    document.getElementById('btn-cancel-edit').classList.add('hidden');
    document.getElementById('btn-auto-loyer').classList.remove('hidden');
};

window.duplicateTransaction = function(id) {
    const t = allTransactions.find(x => x.id === id);
    if(!t) return;
    cancelEditTransaction();
    document.getElementById('trans_amount').value = t.amount;
    document.getElementById('trans_desc').value = t.desc + " (Copie)";
    
    const assignedRadios = document.getElementsByName('trans_assigned');
    for(let radio of assignedRadios) {
        radio.checked = (radio.value === (t.assigned || 'proprietaire'));
    }

    const select = document.getElementById('trans_type');
    if(Array.from(select.options).some(opt => opt.value === t.type)) { select.value = t.type; toggleCustomType(); } 
    else { select.value = 'autre'; document.getElementById('trans_type_custom').value = t.type; toggleCustomType(); }
    
    document.getElementById('transaction-form').scrollIntoView({behavior: 'smooth'});
    showToast("Opération chargée. Modifiez si besoin et cliquez sur Ajouter.");
};

document.getElementById('transaction-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;

    let finalType = document.getElementById('trans_type').value;
    let customTypeVal = document.getElementById('trans_type_custom').value.trim();
    
    // Logique de création de catégorie sauvegardée de façon permanente
    if (finalType === 'autre') {
        if (!customTypeVal) { showToast("Veuillez saisir un nom pour la catégorie.", true); return; }
        finalType = capitalize(customTypeVal);
        if (!appSettings.custom_categories) appSettings.custom_categories = [];
        if (!appSettings.custom_categories.includes(finalType)) {
            appSettings.custom_categories.push(finalType);
            await saveDataToCloud(true); // Sauvegarde silencieuse de la catégorie
            renderCategories();
            document.getElementById('trans_type').value = finalType;
        }
    }

    const amount = parseFloat(document.getElementById('trans_amount').value);
    const desc = document.getElementById('trans_desc').value;
    const startDateStr = document.getElementById('trans_date').value;
    const isRecurrent = document.getElementById('trans_recurrence').checked;
    const recurrenceMonths = parseInt(document.getElementById('trans_recurrence_months').value) || 1;
    const transId = document.getElementById('trans_id').value;
    const assignedTo = document.querySelector('input[name="trans_assigned"]:checked').value;

    const btn = document.getElementById('btn-submit-trans');
    const originalBtnHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Traitement...';
    btn.disabled = true;

    try {
        if (transId) {
            await updateDoc(doc(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions', transId), {
                type: finalType, date: startDateStr, amount: amount, desc: desc, assigned: assignedTo, timestamp: new Date().toISOString()
            });
            showToast("Opération modifiée avec succès.");
            cancelEditTransaction();
        } else {
            let numIterations = isRecurrent ? Math.min(Math.max(recurrenceMonths, 1), 120) : 1;
            const [sy, sm, sd] = startDateStr.split('-').map(Number);
            const transCol = collection(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions');
            const batch = writeBatch(db);

            for(let i=0; i<numIterations; i++) {
                // Date locale ; si le jour n'existe pas (ex: 31 février), on prend le dernier jour du mois
                const lastDay = new Date(sy, sm - 1 + i + 1, 0).getDate();
                let iterDate = new Date(sy, sm - 1 + i, Math.min(sd, lastDay));

                batch.set(doc(transCol), {
                    type: finalType,
                    date: localDateStr(iterDate),
                    amount: amount,
                    desc: desc + (numIterations > 1 ? ` (${i+1}/${numIterations})` : ''),
                    assigned: assignedTo,
                    timestamp: new Date().toISOString()
                });
            }
            await batch.commit();
            showToast(numIterations > 1 ? `${numIterations} opérations générées avec succès !` : "Opération ajoutée.");
            cancelEditTransaction(); 
        }
    } catch (error) {
        showToast("Erreur lors de l'opération", true);
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
    }
});

window.deleteTransaction = async function(id) {
    if (!currentUser) return;
    const t = allTransactions.find(x => x.id === id);
    if (!confirm(`Supprimer définitivement cette opération ?\n\n${t ? `${formatDateFr(t.date)} —${t.desc} — ${formatMontant(t.amount)}` : ''}`)) return;
    try {
        await deleteDoc(doc(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions', id));
        showToast("Opération supprimée");
    } catch (error) { showToast("Erreur suppression", true); }
};

window.autoGenerateLoyer = async function() {
    if (!currentUser) return;
    const loyerTotal = (parseFloat(document.getElementById('loyer_base').value) || 0) + (parseFloat(document.getElementById('loyer_charges').value) || 0);
    if(loyerTotal === 0) { showToast("Configurez d'abord le loyer dans 'Bail'.", true); return; }
    
    const date = new Date();
    const monthName = capitalize(date.toLocaleDateString('fr-FR', { month: 'long' }));
    const todayStr = localDateStr(date);
    const dejaEncaisse = allTransactions.filter(t => t.type === 'loyer' && t.date.startsWith(todayStr.slice(0, 7)));
    if (dejaEncaisse.length > 0) {
        const somme = dejaEncaisse.reduce((s, t) => s + t.amount, 0);
        if (!confirm(`Un loyer de ${formatMontant(somme)} est déjà enregistré pour ${monthName} ${date.getFullYear()}. En ajouter un autre quand même ?`)) return;
    }
    try {
        await addDoc(collection(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions'), {
            type: 'loyer', date: todayStr, amount: loyerTotal, desc: `Loyer encaissé - ${monthName} ${date.getFullYear()}`, assigned: 'locataire', timestamp: new Date().toISOString()
        });
        showToast("Loyer du mois ajouté !");
    } catch (error) { showToast("Erreur lors de l'ajout automatique", true); }
}

// --- Export CSV & JSON ---
window.exportCSV = function() {
    if (allTransactions.length === 0) { showToast("Aucune donnée à exporter.", true); return; }
    let csvContent = "Date;Type d'opération;Assigné à;Description;Montant (€)\n";
    allTransactions.forEach(t => {
        const dateFormatee = formatDateFr(t.date);
        const descFormatee = `"${t.desc.replace(/"/g, '""')}"`;
        const amountFormate = t.amount.toString().replace('.', ',');
        const assignedFormate = t.assigned === 'locataire' ? 'Locataire' : 'Propriétaire';
        csvContent += `${dateFormatee};${t.type};${assignedFormate};${descFormatee};${amountFormate}\n`;
    });
    triggerDownload(new Blob(["\uFEFF" + csvContent], { type: 'text/csv;charset=utf-8;' }), `Historique_${localDateStr()}.csv`);
}

window.exportJSON = function() {
    const data = { dateExport: new Date().toISOString(), profil: appSettings, transactions: allTransactions };
    triggerDownload(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `Sauvegarde_Complete_${localDateStr()}.json`);
    showToast("Sauvegarde JSON téléchargée !");
}

// Restaure une sauvegarde JSON (profil + opérations). Les opérations déjà présentes (même id) sont écrasées, pas dupliquées.
window.importJSON = function(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file || !currentUser) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        let data;
        try { data = JSON.parse(e.target.result); } catch { showToast("Fichier JSON invalide.", true); return; }
        if (!data || !Array.isArray(data.transactions)) { showToast("Ce fichier n'est pas une sauvegarde ImmoGérer.", true); return; }
        if (!confirm(`Restaurer ${data.transactions.length} opération(s)${data.profil ? ' et le profil' : ''} ? Le profil actuel sera remplacé.`)) return;
        try {
            const transCol = collection(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions');
            // Firestore limite un lot à 500 écritures
            for (let i = 0; i < data.transactions.length; i += 400) {
                const batch = writeBatch(db);
                data.transactions.slice(i, i + 400).forEach(t => {
                    const { id, ...rest } = t;
                    batch.set(id ? doc(transCol, id) : doc(transCol), rest);
                });
                await batch.commit();
            }
            if (data.profil) {
                await setDoc(doc(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'settings', 'profile'), data.profil);
                await loadDataFromCloud();
                updateDashboard();
            }
            showToast("Sauvegarde restaurée !");
        } catch (err) { showToast("Erreur pendant la restauration.", true); }
    };
    reader.readAsText(file);
};

function triggerDownload(blob, filename) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob); link.download = filename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// --- AFFICHAGE ET CALCULS ---
function updateDashboard() {
    let totalLoyers = 0, totalCharges = 0, totalTravaux = 0, totalDepenses = 0;
    let depensesAnneeReelles = 0; 
    const anneeCourante = new Date().getFullYear().toString();
    
    const todayStr = localDateStr();

    let minDate = todayStr;
    let hasPastTransactions = false;

    allTransactions.forEach(t => {
        // FILTRE : On ignore toutes les transactions dans le futur
        if (t.date > todayStr) return;

        hasPastTransactions = true;
        if (t.date < minDate) minDate = t.date;

        if (t.type === 'loyer') totalLoyers += t.amount;
        else if (t.type === 'charge') totalCharges += t.amount;
        else if (t.type === 'travaux') totalTravaux += t.amount;
        else totalDepenses += t.amount; 

        if (t.date.startsWith(anneeCourante) && t.type !== 'loyer') depensesAnneeReelles += t.amount;
    });

    const mensualiteCredit = parseFloat(document.getElementById('credit_mensualite')?.value) || 0;
    
    // Nombre de mensualités déjà payées : depuis la date de début du crédit si elle est renseignée,
    // sinon (ancien comportement) depuis la première opération enregistrée.
    const creditDebut = document.getElementById('credit_debut')?.value || '';
    const startKey = creditDebut || (hasPastTransactions ? minDate.slice(0, 7) : '');
    let monthsPassed = 0;
    if (startKey) {
        const [y0, m0] = startKey.split('-').map(Number);
        const dToday = new Date();
        monthsPassed = Math.max(0, (dToday.getFullYear() - y0) * 12 + (dToday.getMonth() + 1 - m0) + 1);
    }
    const totalCreditHistorique = monthsPassed * mensualiteCredit;

    // Déduction du crédit dans le solde global
    const solde = totalLoyers - (totalCharges + totalTravaux + totalDepenses + totalCreditHistorique);
    
    document.getElementById('stat-loyers').innerText = formatMontant(totalLoyers);
    document.getElementById('stat-charges').innerText = formatMontant(totalCharges);
    document.getElementById('stat-travaux').innerText = formatMontant(totalTravaux);
    
    const elSolde = document.getElementById('stat-solde');
    elSolde.innerText = formatMontant(solde);
    elSolde.className = solde >= 0 ? "text-lg sm:text-2xl font-bold text-green-600" : "text-lg sm:text-2xl font-bold text-red-600";

    const dashList = document.getElementById('dash-transactions-list');
    dashList.innerHTML = '';
    
    // On ne garde que les opérations passées ou d'aujourd'hui pour la liste récente
    const pastTransactions = allTransactions.filter(t => t.date <= todayStr);
    const recent = pastTransactions.slice(0, 5);
    
    if (recent.length === 0) dashList.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-500">Aucune opération.</td></tr>`;
    else recent.forEach(t => dashList.appendChild(createTransactionRow(t, false)));

    const prixAchat = parseFloat(document.getElementById('prix_achat')?.value) || 0;
    const loyerTotalMensuelAttendu = (parseFloat(document.getElementById('loyer_base')?.value) || 0) + (parseFloat(document.getElementById('loyer_charges')?.value) || 0);
    
    const cashflow = loyerTotalMensuelAttendu - mensualiteCredit;
    const elCash = document.getElementById('stat-cashflow');
    elCash.innerText = formatMontant(cashflow);
    elCash.className = cashflow >= 0 ? "text-2xl font-bold text-purple-900" : "text-2xl font-bold text-red-600";

    if (prixAchat > 0 && loyerTotalMensuelAttendu > 0) {
        document.getElementById('stat-renta-brute').innerText = (((loyerTotalMensuelAttendu * 12) / prixAchat) * 100).toFixed(2) + " %";
        // Rentabilité nette (définition usuelle) : loyers annuels - charges réelles de l'année, HORS crédit.
        // Le crédit relève du financement (et du cashflow), pas de la rentabilité du bien.
        document.getElementById('stat-renta-nette').innerText = ((((loyerTotalMensuelAttendu * 12) - depensesAnneeReelles) / prixAchat) * 100).toFixed(2) + " %";
    } else {
        document.getElementById('stat-renta-brute').innerText = "0.00 %";
        document.getElementById('stat-renta-nette').innerText = "0.00 %";
    }
    renderChart(anneeCourante, mensualiteCredit, todayStr);
}

function renderChart(annee, mensualiteCredit, todayStr) {
    const ctx = document.getElementById('financeChart').getContext('2d');
    if (financeChartInstance) financeChartInstance.destroy();

    let monthlyIncome = new Array(12).fill(0), monthlyExpense = new Array(12).fill(0), monthlyCredit = new Array(12).fill(mensualiteCredit);

    allTransactions.forEach(t => {
        // FILTRE : On ignore toutes les transactions dans le futur
        if (t.date > todayStr) return;

        if (t.date.startsWith(annee)) {
            let monthIdx = parseInt(t.date.split('-')[1]) - 1;
            if (t.type === 'loyer') monthlyIncome[monthIdx] += t.amount;
            else monthlyExpense[monthIdx] += t.amount; 
        }
    });

    financeChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'],
            datasets: [
                { label: 'Revenus (€)', data: monthlyIncome, backgroundColor: '#22c55e', borderRadius: 4 },
                { label: 'Dépenses (€)', data: monthlyExpense, backgroundColor: '#ef4444', borderRadius: 4 },
                { label: 'Crédit Immo (€)', data: monthlyCredit, backgroundColor: '#cbd5e1', borderRadius: 4, type: 'line', borderDash: [5, 5], fill: false, borderColor: '#94a3b8' }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top' } } }
    });
}

// --- CALENDRIER ---
function initOrUpdateCalendar() {
    const calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;

    const eventsData = allTransactions.map(t => {
        let eventColor = '#64748b'; 
        if (t.type === 'loyer') eventColor = '#22c55e'; 
        else if (t.type === 'charge') eventColor = '#ef4444';
        else if (t.type === 'charge_immo') eventColor = '#d946ef'; 
        else if (t.type === 'taxe_fonciere') eventColor = '#f43f5e'; 
        else if (t.type === 'csg') eventColor = '#ec4899'; 
        else if (t.type === 'travaux') eventColor = '#f97316'; 

        return { title: `${t.type === 'loyer' ? '+' : '-'}${t.amount}€ | ${t.desc}`, start: t.date, color: eventColor, allDay: true };
    });

    if (!calendarInstance) {
        calendarInstance = new FullCalendar.Calendar(calendarEl, {
            // Sur téléphone, la vue "Liste" est bien plus lisible que la grille du mois
            initialView: window.innerWidth < 768 ? 'listMonth' : 'dayGridMonth', locale: 'fr',
            headerToolbar: window.innerWidth < 768
                ? { left: 'prev,next', center: 'title', right: 'listMonth,dayGridMonth' }
                : { left: 'prev,next today', center: 'title', right: 'dayGridMonth,listMonth' },
            buttonText: { today: "Aujourd'hui", month: 'Mois', list: 'Liste' },
            noEventsContent: 'Aucune opération ce mois-ci',
            events: eventsData, height: window.innerWidth < 768 ? 'auto' : '100%'
        });
        calendarInstance.render();
    } else {
        calendarInstance.removeAllEvents();
        calendarInstance.addEventSource(eventsData);
        calendarInstance.render(); 
    }
}

function renderTransactionsTable() {
    const list = document.getElementById('full-transactions-list');
    list.innerHTML = '';
    if (allTransactions.length === 0) list.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-500">Aucune opération.</td></tr>`;
    else allTransactions.forEach(t => list.appendChild(createTransactionRow(t, true)));
}

function createTransactionRow(t, isFullTable) {
    const tr = document.createElement('tr');
    let typeBadge, amountColor;
    const sign = (t.type === 'loyer') ? '+' : '-';

    if (t.type === 'loyer') { typeBadge = '<span class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold">Loyer</span>'; amountColor = 'text-green-600 font-bold'; }
    else if (t.type === 'charge') { typeBadge = '<span class="bg-red-100 text-red-700 px-2 py-1 rounded text-xs font-bold">Charge R.</span>'; amountColor = 'text-red-600'; }
    else if (t.type === 'charge_immo') { typeBadge = '<span class="bg-fuchsia-100 text-fuchsia-700 px-2 py-1 rounded text-xs font-bold">Charge Immo.</span>'; amountColor = 'text-fuchsia-600'; }
    else if (t.type === 'taxe_fonciere') { typeBadge = '<span class="bg-rose-100 text-rose-700 px-2 py-1 rounded text-xs font-bold">Taxe Fonc.</span>'; amountColor = 'text-rose-600'; }
    else if (t.type === 'csg') { typeBadge = '<span class="bg-pink-100 text-pink-700 px-2 py-1 rounded text-xs font-bold">CSG</span>'; amountColor = 'text-pink-600'; }
    else if (t.type === 'travaux') { typeBadge = '<span class="bg-orange-100 text-orange-700 px-2 py-1 rounded text-xs font-bold">Travaux</span>'; amountColor = 'text-orange-600'; }
    else if (t.type === 'depense') { typeBadge = '<span class="bg-slate-200 text-slate-700 px-2 py-1 rounded text-xs font-bold">Dépense</span>'; amountColor = 'text-slate-600'; }
    else { const ty = escapeHtml(t.type); typeBadge = `<span class="bg-indigo-100 text-indigo-700 px-2 py-1 rounded text-xs font-bold uppercase truncate max-w-[120px] inline-block align-bottom" title="${ty}">${ty}</span>`; amountColor = 'text-slate-600'; }

    // Badge d'assignation
    const assigneeBadge = (t.assigned === 'locataire') 
        ? `<span class="mt-1 inline-block text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded uppercase tracking-wider border border-blue-200"><i class="fa-solid fa-user"></i> Locataire</span>`
        : `<span class="mt-1 inline-block text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded uppercase tracking-wider border border-purple-200"><i class="fa-solid fa-user-tie"></i> Propriétaire</span>`;

    const displayDate = formatDateFr(t.date);
    
    let actionHtml = '<span class="text-slate-300">-</span>';
    if (isFullTable) {
        actionHtml = `
            <div class="flex flex-col sm:flex-row justify-center items-center gap-0 sm:gap-1">
                <button onclick="editTransaction('${t.id}')" class="text-blue-500 hover:text-blue-700 p-2 rounded hover:bg-blue-50 transition" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                <button onclick="duplicateTransaction('${t.id}')" class="text-emerald-500 hover:text-emerald-700 p-2 rounded hover:bg-emerald-50 transition" title="Dupliquer"><i class="fa-solid fa-copy"></i></button>
                <button onclick="deleteTransaction('${t.id}')" class="text-red-500 hover:text-red-700 p-2 rounded hover:bg-red-50 transition" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
            </div>`;
    }

    tr.innerHTML = `
        <td class="p-2 sm:p-3 text-slate-700 whitespace-nowrap text-xs sm:text-sm">${displayDate}</td>
        <td class="p-3 hidden sm:table-cell">${typeBadge}</td>
        <td class="p-2 sm:p-3 text-slate-700 font-medium leading-tight break-words"><div class="sm:hidden mb-1">${typeBadge}</div>${escapeHtml(t.desc)}<br>${assigneeBadge}</td>
        <td class="p-2 sm:p-3 text-right whitespace-nowrap ${amountColor}">${sign} ${formatMontant(t.amount)}</td>
        ${isFullTable ? `<td class="p-1 sm:p-3 text-center">${actionHtml}</td>` : ''}
    `;
    return tr;
}

// --- REGULARISATION ---
window.calculateRegularization = function() {
    const yearStr = document.getElementById('reg_year').value;
    if (!yearStr) return;
    
    let base = parseFloat(document.getElementById('loyer_base').value) || 0;
    let charges = parseFloat(document.getElementById('loyer_charges').value) || 0;
    let totalAttendu = base + charges;
    
    let ratioProvision = totalAttendu > 0 ? (charges / totalAttendu) : 0;
    let totalLoyerRecu = 0, totalChargesReelles = 0;
    
    const todayStr = localDateStr();

    allTransactions.forEach(t => {
        // FILTRE : On ignore toutes les transactions dans le futur
        if (t.date > todayStr) return;

        if (t.date.startsWith(yearStr)) {
            if (t.type === 'loyer') totalLoyerRecu += t.amount;
            // Charge récupérable = catégorie "charge" OU toute dépense imputée au locataire
            else if (t.type === 'charge' || t.assigned === 'locataire') totalChargesReelles += t.amount;
        }
    });

    let provisionsVersees = totalLoyerRecu * ratioProvision;
    let bilan = provisionsVersees - totalChargesReelles;

    document.getElementById('reg_provisions').innerText = formatMontant(provisionsVersees);
    document.getElementById('reg_charges').innerText = formatMontant(totalChargesReelles);
    const diffEl = document.getElementById('reg_diff'), msgEl = document.getElementById('reg_message'), box = document.getElementById('reg_result_box');
    diffEl.innerText = formatMontant(Math.abs(bilan));

    if (bilan > 0) { box.className = "p-6 rounded-xl text-center border-2 border-green-300 bg-green-50"; diffEl.className = "text-3xl font-black mb-2 text-green-700"; msgEl.innerText = "Trop-perçu : vous devez rendre cette somme au locataire."; } 
    else if (bilan < 0) { box.className = "p-6 rounded-xl text-center border-2 border-red-300 bg-red-50"; diffEl.className = "text-3xl font-black mb-2 text-red-700"; msgEl.innerText = "Déficit : vous pouvez réclamer cette somme au locataire."; } 
    else { box.className = "p-6 rounded-xl text-center border-2 border-slate-200 bg-slate-50"; diffEl.className = "text-3xl font-black mb-2 text-slate-700"; msgEl.innerText = "Parfait équilibre."; }
};

// --- SIGNATURE ET UTILS ---
document.getElementById('signature_file').addEventListener('change', function(e) {
    const file = e.target.files[0];
    if (!file) return;
    // Redimensionne l'image (max 500x250) : un document Firestore est limité à 1 Mo
    const reader = new FileReader();
    reader.onload = function(event) {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, 500 / img.width, 250 / img.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
            canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
            currentSignatureData = canvas.toDataURL('image/png');
            if (currentSignatureData.length > 700000) currentSignatureData = canvas.toDataURL('image/jpeg', 0.85);
            showSignaturePreview(currentSignatureData);
            showToast("Signature modifiée ! Pensez à sauvegarder.");
        };
        img.onerror = () => showToast("Image de signature illisible.", true);
        img.src = event.target.result;
    };
    reader.readAsDataURL(file);
});

function showSignaturePreview(src) {
    const img = document.getElementById('signature_preview'), placeholder = document.getElementById('signature_placeholder');
    img.src = src; img.classList.remove('hidden'); placeholder.classList.add('hidden');
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast'), icon = document.getElementById('toast-icon');
    document.getElementById('toast-msg').innerText = message;
    
    if (isError) { toast.className = "hidden opacity-0 transition-opacity duration-300 fixed top-6 right-6 px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg bg-red-100 text-red-800 border border-red-200 z-50"; icon.className = "fa-solid fa-circle-exclamation"; } 
    else { toast.className = "hidden opacity-0 transition-opacity duration-300 fixed top-6 right-6 px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg bg-green-100 text-green-800 border border-green-200 z-50"; icon.className = "fa-solid fa-check-circle"; }

    toast.classList.remove('hidden'); void toast.offsetWidth; toast.classList.remove('opacity-0'); toast.classList.add('opacity-100');
    setTimeout(() => { toast.classList.remove('opacity-100'); toast.classList.add('opacity-0'); setTimeout(() => toast.classList.add('hidden'), 300); }, 5000);
}

function formatMontant(montant) { return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(montant); }
function capitalize(str) { return str.charAt(0).toUpperCase() + str.slice(1); }
// Date au format YYYY-MM-DD en heure locale (toISOString() est en UTC et décale la date la nuit)
function localDateStr(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
// Affiche "YYYY-MM-DD" en JJ/MM/AAAA sans passer par un objet Date UTC
function formatDateFr(s) { const [y, m, d] = (s || '').split('-'); return d ? `${d}/${m}/${y}` : s; }
function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// --- GÉNÉRATION DU PDF (Quittances) ---
const PDF_OPTIONS = { margin: 0, image: { type: 'jpeg', quality: 0.98 }, html2canvas: { scale: 2, useCORS: true }, jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' } };

// Construit les pages dans #pdf-workspace. Une quittance n'est émise que pour un mois dont le loyer
// a été encaissé (opérations "loyer" de ce mois) ; un paiement incomplet donne un reçu partiel.
// Retourne null si la période est invalide.
function buildQuittances() {
    const nl2br = s => escapeHtml(s).replace(/\n/g, '<br>');
    const data = {
        bailleur_nom: escapeHtml(document.getElementById('bailleur_nom').value), bailleur_adresse: nl2br(document.getElementById('bailleur_adresse').value),
        locataire_nom: escapeHtml(document.getElementById('locataire_nom').value), logement_adresse: nl2br(document.getElementById('logement_adresse').value),
        loyer_base: parseFloat(document.getElementById('loyer_base').value) || 0, loyer_charges: parseFloat(document.getElementById('loyer_charges').value) || 0,
        lieu_emission: escapeHtml(document.getElementById('lieu_emission').value || '...'), signature: currentSignatureData
    };
    data.total = data.loyer_base + data.loyer_charges;
    const dateDebut = document.getElementById('date_debut').value, dateFin = document.getElementById('date_fin').value;

    if (!dateDebut || !dateFin) { showToast("Sélectionnez une période valide.", true); return null; }
    if (data.total <= 0) { showToast("Configurez d'abord le loyer dans 'Bail'.", true); return null; }
    const [sy, sm] = dateDebut.split('-').map(Number), [ey, em] = dateFin.split('-').map(Number);
    let start = new Date(sy, sm - 1, 1), end = new Date(ey, em - 1, 1);
    if (start > end) { showToast("Erreur de dates.", true); return null; }

    const workspace = document.getElementById('pdf-workspace');
    workspace.innerHTML = '';

    let currentMonthIterator = new Date(start), dateGeneration = new Date().toLocaleDateString('fr-FR');
    const result = { full: 0, partial: 0, unpaid: [], filename: `Quittances_${dateDebut}_a_${dateFin}.pdf` };

    while (currentMonthIterator <= end) {
        let year = currentMonthIterator.getFullYear(), monthIdx = currentMonthIterator.getMonth();
        let monthName = capitalize(currentMonthIterator.toLocaleDateString('fr-FR', { month: 'long' }));
        let firstDay = new Date(year, monthIdx, 1), lastDay = new Date(year, monthIdx + 1, 0);
        let periodStartStr = firstDay.toLocaleDateString('fr-FR'), periodEndStr = lastDay.toLocaleDateString('fr-FR');

        const monthKey = `${year}-${String(monthIdx + 1).padStart(2, '0')}`;
        const paid = allTransactions.filter(t => t.type === 'loyer' && t.date.startsWith(monthKey)).reduce((s, t) => s + t.amount, 0);
        currentMonthIterator.setMonth(currentMonthIterator.getMonth() + 1);
        if (paid <= 0) { result.unpaid.push(`${monthName} ${year}`); continue; }

        const isFull = paid >= data.total - 0.005;
        isFull ? result.full++ : result.partial++;
        const docTitle = isFull ? 'Quittance de Loyer' : 'Reçu de paiement partiel';
        const detailHtml = isFull
            ? `<tr><td style="padding: 8px 0;">Loyer de base</td><td style="padding: 8px 0; text-align: right;">${formatMontant(data.loyer_base)}</td></tr>
               <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">Provisions pour charges</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatMontant(data.loyer_charges)}</td></tr>
               <tr><td style="padding: 12px 0; font-weight: bold; font-size: 18px;">Total reçu</td><td style="padding: 12px 0; font-weight: bold; font-size: 18px; text-align: right; color: #2563eb;">${formatMontant(paid)}</td></tr>`
            : `<tr><td style="padding: 8px 0;">Montant dû (loyer + charges)</td><td style="padding: 8px 0; text-align: right;">${formatMontant(data.total)}</td></tr>
               <tr><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb;">Montant reçu</td><td style="padding: 8px 0; border-bottom: 1px solid #e5e7eb; text-align: right;">${formatMontant(paid)}</td></tr>
               <tr><td style="padding: 12px 0; font-weight: bold; font-size: 18px;">Reste dû</td><td style="padding: 12px 0; font-weight: bold; font-size: 18px; text-align: right; color: #dc2626;">${formatMontant(data.total - paid)}</td></tr>`;
        const recuText = isFull
            ? `Reçu de <strong>${data.locataire_nom}</strong> la somme de <strong>${formatMontant(paid)}</strong>,
                        au titre du paiement du loyer et des charges du local d'habitation désigné ci-dessus, pour la période du <strong>${periodStartStr}</strong> au <strong>${periodEndStr}</strong>.`
            : `Reçu de <strong>${data.locataire_nom}</strong> la somme de <strong>${formatMontant(paid)}</strong>,
                        à titre d'acompte sur le loyer et les charges du local d'habitation désigné ci-dessus, pour la période du <strong>${periodStartStr}</strong> au <strong>${periodEndStr}</strong>. Ce reçu ne vaut pas quittance.`;
        const mentionText = isFull
            ? `En application de l'article 21 de la loi n° 89-462 du 6 juillet 1989, la présente quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme. <br>
                        Le paiement de la présente quittance n'emporte pas présomption de paiement des termes antérieurs.<br>Sous réserve de tous mes droits pour le passé et l'avenir.`
            : `Paiement partiel : une quittance sera délivrée après règlement intégral du terme.<br>Sous réserve de tous mes droits pour le passé et l'avenir.`;

        let pageHtml = `
            <div class="quittance-page">
                <div style="border-bottom: 2px solid #2563eb; padding-bottom: 15px; margin-bottom: 30px;">
                    <h1 style="font-size: 24px; color: #1e3a8a; margin: 0; text-transform: uppercase; font-weight: bold; text-align: center;">${docTitle}</h1>
                    <p style="text-align: center; margin-top: 5px; font-size: 16px; color: #4b5563;">Mois de : <strong>${monthName} ${year}</strong></p>
                </div>
                <div style="display: flex; justify-content: space-between; margin-bottom: 40px;">
                    <div style="width: 45%;">
                        <h3 style="font-size: 14px; color: #6b7280; margin-bottom: 5px; text-transform: uppercase;">Bailleur</h3>
                        <p style="font-weight: bold; margin: 0;">${data.bailleur_nom}</p>
                        <p style="margin: 5px 0 0 0; line-height: 1.4;">${data.bailleur_adresse}</p>
                    </div>
                    <div style="width: 45%; background-color: #f3f4f6; padding: 15px; border-radius: 8px;">
                        <h3 style="font-size: 14px; color: #6b7280; margin-bottom: 5px; text-transform: uppercase;">Locataire</h3>
                        <p style="font-weight: bold; margin: 0;">${data.locataire_nom}</p>
                        <p style="margin: 5px 0 0 0; line-height: 1.4;">Adresse de location :<br>${data.logement_adresse}</p>
                    </div>
                </div>
                <div style="margin-bottom: 30px;">
                    <p style="font-size: 15px; line-height: 1.6; text-align: justify;">
                        ${recuText}
                    </p>
                </div>
                <div style="margin-bottom: 40px;">
                    <h3 style="font-size: 16px; border-bottom: 1px solid #e5e7eb; padding-bottom: 5px; margin-bottom: 15px;">Détail du règlement</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        ${detailHtml}
                    </table>
                </div>
                <div style="margin-bottom: 40px;">
                    <p style="font-size: 12px; color: #6b7280; font-style: italic;">
                        ${mentionText}
                    </p>
                </div>
                <div style="display: flex; justify-content: flex-end;">
                    <div style="text-align: right; width: 300px;">
                        <p style="margin-bottom: 15px;">Fait à <strong>${data.lieu_emission}</strong>, le <strong>${dateGeneration}</strong></p>
                        <p style="margin-bottom: 10px;">Le Bailleur,</p>
                        ${data.signature ? `<img src="${data.signature}" style="max-width: 200px; max-height: 100px; margin-left: auto; display: block;" alt="Signature">` : '<div style="height: 80px; border: 1px dashed #ccc; display: flex; align-items: center; justify-content: center; color: #999; font-size: 12px;">[Signature manquante]</div>'}
                    </div>
                </div>
            </div>
        `;
        workspace.insertAdjacentHTML('beforeend', pageHtml);
    }

    if (result.full + result.partial === 0) {
        showToast(`Aucun loyer encaissé sur la période : pas de quittance à émettre. Enregistrez d'abord le paiement dans 'Finances'.`, true);
        return null;
    }
    return result;
}

function quittanceSummary(r) {
    let msg = `${r.full} quittance(s)`;
    if (r.partial) msg += `, ${r.partial} reçu(s) partiel(s)`;
    if (r.unpaid.length) msg += ` — non payé(s), ignoré(s) : ${r.unpaid.join(', ')}`;
    return msg;
}

// Lance un rendu html2pdf sur l'espace de travail, puis le nettoie quoi qu'il arrive.
async function renderWorkspacePdf(run) {
    const workspace = document.getElementById('pdf-workspace');
    workspace.style.display = 'block';
    try { return await run(window.html2pdf().set(PDF_OPTIONS).from(workspace)); }
    finally { workspace.style.display = 'none'; workspace.innerHTML = ''; }
}

function setPdfBusy(btn, busy) {
    document.getElementById('loading-spinner').classList.toggle('hidden', !busy);
    btn.classList.toggle('hidden', busy);
}

document.getElementById('btn-generate').addEventListener('click', async () => {
    const btn = document.getElementById('btn-generate');
    const r = buildQuittances();
    if (!r) return;
    setPdfBusy(btn, true);
    try {
        await renderWorkspacePdf(w => w.set({ filename: r.filename }).save());
        showToast("PDF généré : " + quittanceSummary(r));
    } catch (error) { showToast("Erreur création PDF.", true); }
    finally { setPdfBusy(btn, false); }
});

// --- GESTION DE L'API GMAIL ---
window.authorizeGmail = function(callback) {
    const clientId = document.getElementById('google_client_id').value;
    if (!clientId) { showToast("Veuillez renseigner votre ID Client Google au-dessus.", true); return; }
    try {
        google.accounts.oauth2.initTokenClient({
            client_id: clientId, scope: 'https://www.googleapis.com/auth/gmail.send',
            callback: (tokenResponse) => {
                if (tokenResponse && tokenResponse.access_token) { gmailToken = tokenResponse.access_token; showToast("Autorisation Gmail réussie !"); if(typeof callback === 'function') callback(); } 
                else { showToast("L'autorisation a échoué ou a été annulée.", true); }
            },
        }).requestAccessToken();
    } catch (err) { showToast("Erreur d'initialisation Google. Vérifiez l'ID Client.", true); }
};

// Base64 standard (RFC 2045/2047) : requis pour les en-têtes et le corps MIME
function encodeBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binString = ''; for (let i = 0; i < bytes.byteLength; i++) { binString += String.fromCharCode(bytes[i]); }
    return btoa(binString);
}
// Base64 "URL-safe" : requis uniquement pour le champ "raw" de l'API Gmail
function encodeBase64Url(str) {
    return encodeBase64(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sendEmailViaGmailAPI(to, subject, body, pdfDataUri, filename = 'quittance.pdf') {
    if (!gmailToken) { showToast("Connexion à Gmail requise.", true); window.authorizeGmail(() => sendEmailViaGmailAPI(to, subject, body, pdfDataUri, filename)); return; }
    showToast("Envoi de l'email en cours...");
    const boundary = "quittance_boundary_" + Date.now().toString(16);
    let email = `To: ${to}\r\nSubject: =?utf-8?B?${encodeBase64(subject)}?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;
    email += `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodeBase64(body)}\r\n\r\n`;
    if (pdfDataUri) {
        const pdfBase64 = pdfDataUri.split(',')[1];
        email += `--${boundary}\r\nContent-Type: application/pdf; name="${filename}"\r\nContent-Disposition: attachment; filename="${filename}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${pdfBase64}\r\n\r\n`;
    }
    email += `--${boundary}--\r\n`;
    try {
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
            method: 'POST', headers: { 'Authorization': `Bearer ${gmailToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw: encodeBase64Url(email) })
        });
        if (response.ok) { showToast("Email envoyé directement avec succès !"); } 
        else {
            const err = await response.json();
            if (err.error && err.error.status === 'UNAUTHENTICATED') { gmailToken = null; window.authorizeGmail(() => sendEmailViaGmailAPI(to, subject, body, pdfDataUri, filename)); }
            else { showToast("Erreur API : Vérifiez votre configuration Gmail", true); }
        }
    } catch (error) { showToast("Erreur réseau lors de l'envoi de l'email.", true); }
}

document.getElementById('btn-generate-email').addEventListener('click', async () => {
    const email = document.getElementById('locataire_email').value;
    if (!email) { showToast("Attention: Renseignez l'email du locataire dans l'onglet 'Bail'", true); switchTab('locataire'); return; }
    if (!document.getElementById('google_client_id').value) { showToast("L'ID Client Google est manquant pour l'envoi direct.", true); switchTab('locataire'); return; }

    const subject = `Votre quittance de loyer`;
    const body = `Bonjour,\n\nVeuillez trouver en pièce jointe votre quittance de loyer.\n\nCordialement,\n${document.getElementById('bailleur_nom').value || 'Le Bailleur'}`;

    // On vérifie la période (loyers encaissés) avant de demander la confirmation
    const r = buildQuittances();
    if (!r) return;
    document.getElementById('pdf-workspace').innerHTML = '';
    const warn = r.unpaid.length ? `<br><br><strong class="text-red-600">Mois non payés, exclus :</strong> ${escapeHtml(r.unpaid.join(', '))}` : '';

    showConfirmModal("Envoi automatique de Quittance", `Vous êtes sur le point d'envoyer au locataire <strong>${escapeHtml(email)}</strong> : ${quittanceSummary({ ...r, unpaid: [] })}.`, `<strong>Sujet :</strong> ${subject}<br><br><strong>Message :</strong><br>${escapeHtml(body).replace(/\n/g, '<br>')}<br><br><em><i class="fa-solid fa-paperclip"></i> ${r.filename} sera générée et attachée automatiquement.</em>${warn}`, async () => {
        const btn = document.getElementById('btn-generate-email');
        const r2 = buildQuittances();
        if (!r2) return;
        setPdfBusy(btn, true);
        try {
            const pdfDataUri = await renderWorkspacePdf(w => w.outputPdf('datauristring'));
            await sendEmailViaGmailAPI(email, subject, body, pdfDataUri, r2.filename);
        } catch (err) { showToast("Erreur lors de la préparation de la pièce jointe.", true); }
        finally { setPdfBusy(btn, false); }
    });
});

window.sendRelanceEmail = function() {
    const email = document.getElementById('locataire_email').value;
    if (!email) { showToast("Veuillez renseigner l'email du locataire au-dessus.", true); return; }
    const total = (parseFloat(document.getElementById('loyer_base').value) || 0) + (parseFloat(document.getElementById('loyer_charges').value) || 0);
    const subject = `Relance : Retard de paiement de loyer`;
    const body = `Bonjour ${document.getElementById('locataire_nom').value || 'Locataire'},\n\nSauf erreur ou omission de ma part, je n'ai pas encore reçu le paiement de votre loyer d'un montant de ${formatMontant(total)} pour le mois en cours.\n\nJe vous remercie de bien vouloir procéder au règlement dans les plus brefs délais.\n\nSi vous avez déjà effectué le paiement entre-temps, veuillez ne pas tenir compte de ce message.\n\nCordialement,\n${document.getElementById('bailleur_nom').value || 'Le Bailleur'}`;

    showConfirmModal("Avertissement : Envoi de Relance", `Vous allez envoyer un email de relance d'impayé à <strong>${escapeHtml(email)}</strong>. Relisez l'aperçu ci-dessous :`, `<strong>Sujet :</strong> ${subject}<br><br><strong>Message :</strong><br>${escapeHtml(body).replace(/\n/g, '<br>')}`, () => { sendEmailViaGmailAPI(email, subject, body, null); });
};
