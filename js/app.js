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
    'caution', 'prix_achat', 'credit_mensualite', 'credit_debut', 'credit_capital', 'credit_taux', 'credit_duree', 'google_client_id'
];
const NUMERIC_FIELDS = ['loyer_base', 'loyer_charges', 'caution', 'prix_achat', 'credit_mensualite', 'credit_capital', 'credit_taux', 'credit_duree'];
let dataLoaded = false;
let currentSignatureData = '';
let financeChartInstance = null; 
let calendarInstance = null;

// Modale de sécurité
let currentConfirmAction = null, currentExtraAction = null;
// options : { confirmLabel, confirmIcon, cancelLabel, extraLabel, onExtra, tone: 'warning' | 'success' }
window.showConfirmModal = function(title, text, preview, onConfirm, options = {}) {
    const success = options.tone === 'success';
    document.getElementById('modal-head').className = `flex items-center gap-3 mb-4 border-b border-slate-100 pb-3 ${success ? 'text-green-600' : 'text-red-600'}`;
    document.getElementById('modal-head-icon').className = `fa-solid ${success ? 'fa-circle-check' : 'fa-triangle-exclamation'} text-2xl`;
    document.getElementById('modal-title').innerText = title;
    document.getElementById('modal-text').innerHTML = text;
    document.getElementById('modal-preview').innerHTML = preview;
    document.getElementById('modal-preview').classList.toggle('hidden', !preview);
    document.getElementById('modal-confirm').innerHTML = `<i class="fa-solid ${options.confirmIcon || 'fa-paper-plane'}"></i> ${escapeHtml(options.confirmLabel || "Oui, envoyer l'email")}`;
    document.getElementById('modal-cancel').innerText = options.cancelLabel || 'Annuler';
    const extra = document.getElementById('modal-extra');
    extra.classList.toggle('hidden', !options.extraLabel);
    extra.innerText = options.extraLabel || '';
    currentExtraAction = options.onExtra || null;
    currentConfirmAction = onConfirm;
    document.getElementById('email-confirm-modal').classList.remove('hidden');
};
window.closeConfirmModal = function() {
    document.getElementById('email-confirm-modal').classList.add('hidden');
    currentConfirmAction = null; currentExtraAction = null;
};
document.getElementById('modal-cancel').addEventListener('click', closeConfirmModal);
document.getElementById('modal-confirm').addEventListener('click', () => {
    const action = currentConfirmAction;
    closeConfirmModal();
    if (action) action();
});
document.getElementById('modal-extra').addEventListener('click', () => {
    const action = currentExtraAction;
    closeConfirmModal();
    if (action) action();
});
document.getElementById('email-confirm-modal').addEventListener('click', (e) => { if (e.target.id === 'email-confirm-modal') closeConfirmModal(); });

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

// --- THÈME (automatique / clair / sombre) ---
const THEMES = { auto: { label: 'Automatique', icon: 'fa-circle-half-stroke' }, light: { label: 'Clair', icon: 'fa-sun' }, dark: { label: 'Sombre', icon: 'fa-moon' } };
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
function getThemeMode() { try { return localStorage.getItem('immogerer-theme') || 'auto'; } catch { return 'auto'; } }
function applyTheme() {
    const mode = getThemeMode();
    const dark = mode === 'dark' || (mode === 'auto' && darkQuery.matches);
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0b1220' : '#1e293b');
    document.querySelectorAll('.theme-icon').forEach(i => i.className = i.className.replace(/fa-(circle-half-stroke|sun|moon)/, THEMES[mode].icon));
    const label = document.getElementById('theme-label');
    if (label) label.innerText = THEMES[mode].label;
    if (typeof Chart !== 'undefined') {
        Chart.defaults.color = dark ? '#cbd5e1' : '#475569';
        Chart.defaults.borderColor = dark ? 'rgba(148,163,184,.15)' : 'rgba(0,0,0,.08)';
    }
    if (dataLoaded) updateDashboard();
}
window.cycleTheme = function() {
    const order = ['auto', 'light', 'dark'];
    const next = order[(order.indexOf(getThemeMode()) + 1) % order.length];
    try { localStorage.setItem('immogerer-theme', next); } catch {}
    applyTheme();
    showToast(`Thème : ${THEMES[next].label}`);
};
darkQuery.addEventListener?.('change', () => { if (getThemeMode() === 'auto') applyTheme(); });
applyTheme();

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
// Une seule définition par catégorie : libellé, libellé court, icône et couleurs (tableau, calendrier, graphiques)
const CATEGORIES = {
    loyer:         { label: 'Loyer perçu (Locataire)',            short: 'Loyer',         icon: 'fa-sack-dollar', color: '#16a34a', badge: 'bg-green-100 text-green-700',     amount: 'text-green-600 font-bold' },
    charge:        { label: 'Charge récupérable (ex: Eau, TEOM)', short: 'Charge récup.', icon: 'fa-droplet',     color: '#dc2626', badge: 'bg-red-100 text-red-700',         amount: 'text-red-600' },
    charge_immo:   { label: 'Charge Immobilière globale',         short: 'Copropriété',   icon: 'fa-building',    color: '#c026d3', badge: 'bg-fuchsia-100 text-fuchsia-700', amount: 'text-fuchsia-600' },
    taxe_fonciere: { label: 'Taxe foncière',                      short: 'Taxe foncière', icon: 'fa-landmark',    color: '#e11d48', badge: 'bg-rose-100 text-rose-700',       amount: 'text-rose-600' },
    csg:           { label: 'CSG',                                short: 'CSG',           icon: 'fa-percent',     color: '#db2777', badge: 'bg-pink-100 text-pink-700',       amount: 'text-pink-600' },
    depense:       { label: 'Dépense proprio (Assurance, frais)', short: 'Dépense',       icon: 'fa-receipt',     color: '#475569', badge: 'bg-slate-200 text-slate-700',     amount: 'text-slate-600' },
    travaux:       { label: 'Travaux / Entretien',                short: 'Travaux',       icon: 'fa-hammer',      color: '#ea580c', badge: 'bg-orange-100 text-orange-700',   amount: 'text-orange-600' }
};
const CUSTOM_CATEGORY = { icon: 'fa-tag', color: '#4f46e5', badge: 'bg-indigo-100 text-indigo-700', amount: 'text-slate-600' };
function catInfo(type) { return CATEGORIES[type] || { ...CUSTOM_CATEGORY, label: type, short: type }; }
function categoryBadge(type) {
    const c = catInfo(type);
    return `<span class="${c.badge} inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-bold max-w-[140px] align-bottom" title="${escapeHtml(c.label)}"><i class="fa-solid ${c.icon} text-[10px]"></i><span class="truncate">${escapeHtml(c.short)}</span></span>`;
}
const defaultCategories = Object.entries(CATEGORIES).map(([value, c]) => ({ value, label: c.label }));

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
                // Un champ numérique enregistré à 0 était vide : on le réaffiche vide
                document.getElementById(field).value = (NUMERIC_FIELDS.includes(field) && appSettings[field] === 0) ? '' : appSettings[field];
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
    NUMERIC_FIELDS.forEach(f => {
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
        allTransactions.sort((a, b) => b.date.localeCompare(a.date) || (b.timestamp || '').localeCompare(a.timestamp || ''));
        dataLoaded = true;
        updateDashboard();
        refreshFilterOptions();
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
            cancelEditTransaction();
            // Un loyer unique qui tombe sur un mois déjà échu : proposer la quittance
            if (finalType === 'loyer' && numIterations === 1 && startDateStr <= localDateStr()) offerQuittanceAfterLoyer(startDateStr.slice(0, 7));
            else showToast(numIterations > 1 ? `${numIterations} opérations générées avec succès !` : "Opération ajoutée.");
        }
    } catch (error) {
        showToast("Erreur lors de l'opération", true);
    } finally {
        btn.innerHTML = originalBtnHtml;
        btn.disabled = false;
    }
});

// --- AJOUT RAPIDE (bouton "+") ---
let quickAddType = 'charge';
function renderQuickAddTypes() {
    const types = Object.keys(CATEGORIES);
    document.getElementById('qa-types').innerHTML = types.map(t => {
        const c = CATEGORIES[t], active = t === quickAddType;
        return `<button type="button" onclick="selectQuickAddType('${t}')" class="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border text-[11px] font-semibold leading-tight transition ${active ? 'border-blue-500 ring-2 ring-blue-200 bg-blue-50 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}">
            <i class="fa-solid ${c.icon} text-base" style="color:${c.color}"></i>${escapeHtml(c.short)}</button>`;
    }).join('') + `<button type="button" onclick="closeQuickAdd(); switchTab('finances'); document.getElementById('trans_type').value='autre'; toggleCustomType(); document.getElementById('trans_type_custom').focus()" class="flex flex-col items-center justify-center gap-1 p-2 rounded-lg border border-dashed border-slate-300 text-[11px] font-semibold text-slate-500 hover:bg-slate-50"><i class="fa-solid fa-ellipsis text-base"></i>Autre…</button>`;
}
window.selectQuickAddType = function(t) {
    quickAddType = t;
    document.getElementById('qa_tenant').checked = (t === 'charge' || t === 'loyer');
    renderQuickAddTypes();
};
window.openQuickAdd = function() {
    if (!currentUser) return;
    document.getElementById('quickadd-form').reset();
    document.getElementById('qa_date').value = localDateStr();
    selectQuickAddType('charge');
    document.getElementById('quickadd-modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('qa_amount').focus(), 100);
};
window.closeQuickAdd = function() { document.getElementById('quickadd-modal').classList.add('hidden'); };

document.getElementById('quickadd-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentUser) return;
    const amount = parseFloat(document.getElementById('qa_amount').value);
    if (!(amount > 0)) { showToast("Saisissez un montant.", true); return; }
    const date = document.getElementById('qa_date').value, desc = document.getElementById('qa_desc').value.trim();
    const btn = document.getElementById('qa-submit');
    btn.disabled = true;
    try {
        await addDoc(collection(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions'), {
            type: quickAddType, date, amount, desc,
            assigned: document.getElementById('qa_tenant').checked ? 'locataire' : 'proprietaire',
            timestamp: new Date().toISOString()
        });
        closeQuickAdd();
        if (quickAddType === 'loyer') offerQuittanceAfterLoyer(date.slice(0, 7));
        else showToast("Opération ajoutée.");
    } catch (err) { showToast("Erreur lors de l'ajout.", true); }
    finally { btn.disabled = false; }
});

window.deleteTransaction = async function(id) {
    if (!currentUser) return;
    const t = allTransactions.find(x => x.id === id);
    if (!t) return;
    const ref = doc(db, 'artifacts', appIdentifier, 'users', currentUser.uid, 'transactions', id);
    const { id: _ignored, ...backup } = t;
    try {
        await deleteDoc(ref);
        // Pas de confirmation : on propose plutôt d'annuler pendant quelques secondes
        showToast(`« ${t.desc} » supprimée`, false, {
            label: 'Annuler', duration: 8000,
            onClick: async () => {
                try { await setDoc(ref, backup); showToast("Opération restaurée."); }
                catch { showToast("Impossible de restaurer l'opération.", true); }
            }
        });
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
        offerQuittanceAfterLoyer(todayStr.slice(0, 7));
    } catch (error) { showToast("Erreur lors de l'ajout automatique", true); }
}

// Après l'encaissement d'un loyer : proposer d'envoyer (ou de télécharger) la quittance du mois
function offerQuittanceAfterLoyer(monthKey) {
    const email = document.getElementById('locataire_email').value;
    const canEmail = email && document.getElementById('google_client_id').value;
    showConfirmModal(
        "Loyer enregistré",
        `Le loyer de <strong>${monthLabel(monthKey)}</strong> est enregistré. ${canEmail ? `Envoyer la quittance à <strong>${escapeHtml(email)}</strong> ?` : 'Voulez-vous la quittance ?'}`,
        canEmail ? `<i class="fa-solid fa-circle-info text-blue-500 mr-1"></i> Un aperçu de l'email vous sera montré avant l'envoi.`
                 : `<i class="fa-solid fa-circle-info text-blue-500 mr-1"></i> Pour l'envoyer par email, renseignez l'email du locataire et l'ID client Google dans « Bail & Locataire ».`,
        canEmail ? () => sendQuittanceFor(monthKey) : () => openQuittanceFor(monthKey),
        { confirmLabel: canEmail ? 'Envoyer la quittance' : 'Voir la quittance', confirmIcon: canEmail ? 'fa-paper-plane' : 'fa-file-pdf', cancelLabel: 'Plus tard',
          extraLabel: canEmail ? 'Voir la quittance' : null, onExtra: () => openQuittanceFor(monthKey), tone: 'success' }
    );
}

// --- Export CSV & JSON ---
window.exportCSV = function() {
    // Exporte ce qui est affiché (filtres compris)
    const rows = getFilteredTransactions();
    if (rows.length === 0) { showToast("Aucune donnée à exporter.", true); return; }
    let csvContent = "Date;Type d'opération;Assigné à;Description;Montant (€)\n";
    rows.forEach(t => {
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

    const credit = getCreditParams();
    const mensualiteCredit = credit.mensualite;

    // Nombre de mensualités déjà payées : depuis la date de début du crédit si elle est renseignée,
    // sinon (ancien comportement) depuis la première opération enregistrée. Plafonné à la durée du prêt.
    const startKey = credit.debut || (hasPastTransactions ? minDate.slice(0, 7) : '');
    let monthsPassed = monthsElapsed(startKey);
    if (credit.n > 0) monthsPassed = Math.min(monthsPassed, credit.n);
    const totalCreditHistorique = monthsPassed * mensualiteCredit;

    // Déduction du crédit dans le solde global
    const solde = totalLoyers - (totalCharges + totalTravaux + totalDepenses + totalCreditHistorique);

    document.getElementById('stat-loyers').innerText = formatMontantCourt(totalLoyers);
    document.getElementById('stat-charges').innerText = formatMontantCourt(totalCharges);
    document.getElementById('stat-travaux').innerText = formatMontantCourt(totalTravaux);

    const elSolde = document.getElementById('stat-solde');
    elSolde.innerText = formatMontantCourt(solde);
    elSolde.className = solde >= 0 ? "text-lg sm:text-2xl font-bold text-green-600" : "text-lg sm:text-2xl font-bold text-red-600";
    if (dataLoaded) document.querySelectorAll('.skeleton').forEach(el => el.classList.remove('skeleton'));

    const dashList = document.getElementById('dash-transactions-list');
    dashList.innerHTML = '';

    // On ne garde que les opérations passées ou d'aujourd'hui pour la liste récente
    const pastTransactions = allTransactions.filter(t => t.date <= todayStr);
    const recent = pastTransactions.slice(0, 5);

    if (recent.length === 0) dashList.innerHTML = emptyStateRow(4, dataLoaded ? "Aucune opération pour l'instant" : 'Chargement…', dataLoaded);
    else recent.forEach(t => dashList.appendChild(createTransactionRow(t, false)));

    renderCredit(credit);

    const prixAchat = parseFloat(document.getElementById('prix_achat')?.value) || 0;
    const loyerTotalMensuelAttendu = (parseFloat(document.getElementById('loyer_base')?.value) || 0) + (parseFloat(document.getElementById('loyer_charges')?.value) || 0);
    
    renderMonthCard(loyerTotalMensuelAttendu);

    const cashflow = loyerTotalMensuelAttendu - mensualiteCredit;
    const elCash = document.getElementById('stat-cashflow');
    elCash.innerText = formatMontantCourt(cashflow);
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

// --- CRÉDIT IMMOBILIER (amortissement) ---
function getCreditParams() {
    const v = id => parseFloat(document.getElementById(id)?.value) || 0;
    const capital = v('credit_capital'), taux = v('credit_taux'), n = Math.round(v('credit_duree') * 12);
    const debut = document.getElementById('credit_debut')?.value || '', saisie = v('credit_mensualite');
    let paiementCalcule = 0;
    if (capital > 0 && n > 0) {
        const r = taux / 100 / 12;
        paiementCalcule = r > 0 ? capital * r / (1 - Math.pow(1 + r, -n)) : capital / n;
    }
    // La mensualité saisie (souvent assurance comprise) reste prioritaire pour le cashflow
    return { capital, taux, n, debut, saisie, paiementCalcule, mensualite: saisie || paiementCalcule };
}

// Nombre de mois écoulés depuis "YYYY-MM" (mois en cours inclus)
function monthsElapsed(startKey) {
    if (!startKey) return 0;
    const [y0, m0] = startKey.split('-').map(Number);
    const d = new Date();
    return Math.max(0, (d.getFullYear() - y0) * 12 + (d.getMonth() + 1 - m0) + 1);
}

function creditSchedule(p) {
    const rows = [], r = p.taux / 100 / 12;
    const [y0, m0] = p.debut.split('-').map(Number);
    let remaining = p.capital;
    for (let k = 0; k < p.n; k++) {
        const interest = remaining * r;
        let principal = p.paiementCalcule - interest;
        if (k === p.n - 1) principal = remaining; // dernière échéance : solde exact
        remaining = Math.max(0, remaining - principal);
        const d = new Date(y0, m0 - 1 + k, 1);
        rows.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, year: d.getFullYear(), interest, principal, remaining });
    }
    return rows;
}

function renderCredit(p) {
    const ready = p.capital > 0 && p.n > 0 && p.debut;
    document.getElementById('credit-empty').classList.toggle('hidden', ready);
    document.getElementById('credit-content').classList.toggle('hidden', !ready);
    if (!ready) { document.getElementById('credit-end').innerText = ''; return; }

    const rows = creditSchedule(p);
    const paidCount = Math.min(monthsElapsed(p.debut), p.n);
    const remaining = paidCount > 0 ? rows[paidCount - 1].remaining : p.capital;
    const repaid = p.capital - remaining;
    const year = new Date().getFullYear();
    const interestYear = rows.filter(r => r.year === year).reduce((s, r) => s + r.interest, 0);
    const pct = p.capital > 0 ? (repaid / p.capital) * 100 : 0;
    const last = rows[rows.length - 1];
    const [ly, lm] = last.key.split('-').map(Number);

    document.getElementById('credit-remaining').innerText = formatMontantCourt(Math.round(remaining));
    document.getElementById('credit-repaid').innerText = formatMontantCourt(Math.round(repaid));
    document.getElementById('credit-interest-label').innerText = `Intérêts ${year}`;
    document.getElementById('credit-interest-year').innerText = formatMontantCourt(Math.round(interestYear));
    document.getElementById('credit-payment').innerText = formatMontant(p.paiementCalcule);
    document.getElementById('credit-progress').style.width = pct.toFixed(1) + '%';
    document.getElementById('credit-progress-label').innerText = pct.toFixed(1).replace('.', ',') + ' %';
    document.getElementById('credit-end').innerText = `Dernière échéance : ${new Date(ly, lm - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}`;

    const byYear = {};
    rows.forEach(r => {
        byYear[r.year] = byYear[r.year] || { interest: 0, principal: 0, remaining: 0 };
        byYear[r.year].interest += r.interest; byYear[r.year].principal += r.principal; byYear[r.year].remaining = r.remaining;
    });
    document.getElementById('credit-table').innerHTML = Object.entries(byYear).map(([y, v]) => `
        <tr class="${Number(y) === year ? 'bg-blue-50 font-semibold' : ''}">
            <td class="p-2 sm:p-3 text-left">${y}${Number(y) === year ? ' <span class="text-[10px] text-blue-600">(en cours)</span>' : ''}</td>
            <td class="p-2 sm:p-3 text-amber-700">${formatMontantCourt(Math.round(v.interest))}</td>
            <td class="p-2 sm:p-3 text-blue-700">${formatMontantCourt(Math.round(v.principal))}</td>
            <td class="p-2 sm:p-3 text-slate-700">${formatMontantCourt(Math.round(v.remaining))}</td>
        </tr>`).join('');
}

// --- CARTE "CE MOIS-CI" ---
function loyerPaidForMonth(monthKey) {
    return allTransactions.filter(t => t.type === 'loyer' && t.date.startsWith(monthKey)).reduce((s, t) => s + t.amount, 0);
}
function monthLabel(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    return capitalize(new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }));
}

function renderMonthCard(expected) {
    const todayStr = localDateStr(), monthKey = todayStr.slice(0, 7);
    const paid = loyerPaidForMonth(monthKey);
    const isPaid = expected > 0 && paid >= expected - 0.005;

    document.getElementById('month-title').innerText = monthLabel(monthKey);
    document.getElementById('month-paid').innerText = formatMontantCourt(paid);
    document.getElementById('month-expected').innerText = expected > 0 ? formatMontantCourt(expected) : 'non configuré';
    document.getElementById('month-progress').style.width = (expected > 0 ? Math.min(100, paid / expected * 100) : 0) + '%';

    const status = document.getElementById('month-status');
    let statusText, statusClass;
    if (!dataLoaded) { statusText = '…'; statusClass = 'bg-white/10'; }
    else if (expected <= 0) { statusText = 'Loyer à configurer'; statusClass = 'bg-white/10 text-slate-200'; }
    else if (isPaid) { statusText = '✓ Loyer payé'; statusClass = 'bg-green-400/20 text-green-200'; }
    else if (paid > 0) { statusText = 'Paiement partiel'; statusClass = 'bg-amber-400/20 text-amber-200'; }
    else { statusText = 'Loyer en attente'; statusClass = 'bg-amber-400/20 text-amber-200'; }
    status.innerText = statusText;
    status.className = `text-xs font-bold px-3 py-1 rounded-full whitespace-nowrap ${statusClass}`;

    // Dépenses du mois (passées) + prévues d'ici la fin du mois
    const monthOps = allTransactions.filter(t => t.type !== 'loyer' && t.date.startsWith(monthKey));
    const spent = monthOps.filter(t => t.date <= todayStr).reduce((s, t) => s + t.amount, 0);
    const planned = monthOps.filter(t => t.date > todayStr).reduce((s, t) => s + t.amount, 0);
    document.getElementById('month-expenses').innerText = formatMontantCourt(spent);
    document.getElementById('month-expenses-detail').innerText = planned > 0 ? `+ ${formatMontantCourt(planned)} prévus d'ici la fin du mois` : `${monthOps.filter(t => t.date <= todayStr).length} opération(s)`;

    // Prochaine échéance = prochaine opération datée dans le futur
    const next = allTransactions.filter(t => t.date > todayStr).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (next) {
        const days = Math.round((new Date(next.date + 'T00:00:00') - new Date(todayStr + 'T00:00:00')) / 86400000);
        document.getElementById('month-next').innerHTML = `<i class="fa-solid ${catInfo(next.type).icon} text-blue-300 mr-1"></i>${escapeHtml(next.desc)} · ${formatMontantCourt(next.amount)}`;
        document.getElementById('month-next-date').innerText = `${formatDateFr(next.date)} · ${days <= 1 ? (days === 1 ? 'demain' : "aujourd'hui") : `dans ${days} jours`}`;
    } else {
        document.getElementById('month-next').innerText = 'Aucune opération prévue';
        document.getElementById('month-next-date').innerHTML = '<span class="opacity-75">Astuce : utilisez « Répéter tous les mois »</span>';
    }

    // Alertes : loyers manquants ou partiels sur les 6 derniers mois (depuis le premier loyer enregistré)
    const alerts = [];
    const firstLoyer = allTransactions.filter(t => t.type === 'loyer').map(t => t.date).sort()[0];
    if (expected > 0 && firstLoyer) {
        const missing = [];
        const d = new Date(); d.setDate(1);
        for (let i = 1; i <= 6; i++) {
            const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
            const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`;
            if (key < firstLoyer.slice(0, 7)) break;
            const p = loyerPaidForMonth(key);
            if (p < expected - 0.005) missing.push(`${monthLabel(key)}${p > 0 ? ` (${formatMontantCourt(p)} reçus)` : ''}`);
        }
        if (missing.length) alerts.push({ icon: 'fa-triangle-exclamation', cls: 'bg-red-500/20 text-red-100 border-red-400/30', text: `Loyer incomplet ou non reçu : ${missing.join(', ')}`, action: `<button type="button" onclick="sendRelanceEmail()" class="underline font-semibold whitespace-nowrap">Relancer</button>` });
    }
    document.getElementById('month-alerts').innerHTML = alerts.map(a => `
        <div class="flex items-start gap-2 text-sm rounded-lg border px-3 py-2 ${a.cls}">
            <i class="fa-solid ${a.icon} mt-0.5"></i><span class="flex-1">${escapeHtml(a.text)}</span>${a.action || ''}
        </div>`).join('');

    // Actions rapides
    const btn = (label, icon, onclick, primary) => `<button type="button" onclick="${onclick}" class="${primary ? 'bg-green-500 hover:bg-green-600 text-white' : 'bg-white/10 hover:bg-white/20 text-white'} text-sm font-semibold py-2 px-3 rounded-lg flex items-center gap-2 transition"><i class="fa-solid ${icon}"></i>${label}</button>`;
    let actions = '';
    if (expected > 0 && !isPaid) actions += btn('Encaisser le loyer', 'fa-bolt', 'autoGenerateLoyer()', true);
    if (paid > 0) actions += btn('Aperçu quittance', 'fa-file-pdf', `openQuittanceFor('${monthKey}')`) + btn('Envoyer la quittance', 'fa-paper-plane', `sendQuittanceFor('${monthKey}')`);
    actions += btn('Opération', 'fa-plus', 'openQuickAdd()');
    document.getElementById('month-actions').innerHTML = dataLoaded ? actions : '';
}

function emptyStateRow(colspan, message, withButton) {
    return `<tr><td colspan="${colspan}" class="p-8 text-center text-slate-500">
        <i class="fa-regular fa-folder-open text-3xl text-slate-300 mb-2 block"></i>
        <p class="font-medium">${escapeHtml(message)}</p>
        ${withButton ? `<button type="button" onclick="openQuickAdd()" class="mt-3 text-sm bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg"><i class="fa-solid fa-plus mr-1"></i> Ajouter une opération</button>` : ''}
    </td></tr>`;
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

    const eventsData = allTransactions.map(t => ({
        title: `${t.type === 'loyer' ? '+' : '-'}${formatMontantCourt(t.amount)} | ${t.desc}`,
        start: t.date, color: catInfo(t.type).color, allDay: true
    }));

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

// --- RECHERCHE & FILTRES ---
function refreshFilterOptions() {
    const yearSel = document.getElementById('filter_year'), typeSel = document.getElementById('filter_type');
    const keepY = yearSel.value, keepT = typeSel.value;
    const years = [...new Set(allTransactions.map(t => t.date.slice(0, 4)))].sort().reverse();
    yearSel.innerHTML = '<option value="">Toutes les années</option>' + years.map(y => `<option value="${y}">${y}</option>`).join('');
    const types = [...new Set(allTransactions.map(t => t.type))];
    typeSel.innerHTML = '<option value="">Toutes catégories</option>' + types.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(catInfo(t).short)}</option>`).join('');
    if (years.includes(keepY)) yearSel.value = keepY;
    if (types.includes(keepT)) typeSel.value = keepT;
}

function getFilteredTransactions() {
    const text = (document.getElementById('filter_text')?.value || '').trim().toLowerCase();
    const year = document.getElementById('filter_year')?.value || '';
    const type = document.getElementById('filter_type')?.value || '';
    return allTransactions.filter(t => {
        if (year && !t.date.startsWith(year)) return false;
        if (type && t.type !== type) return false;
        if (text) {
            const hay = `${t.desc} ${catInfo(t.type).short} ${t.amount} ${String(t.amount).replace('.', ',')} ${formatDateFr(t.date)}`.toLowerCase();
            if (!hay.includes(text)) return false;
        }
        return true;
    });
}
const isFiltered = () => ['filter_text', 'filter_year', 'filter_type'].some(id => document.getElementById(id)?.value);

window.resetFilters = function() {
    ['filter_text', 'filter_year', 'filter_type'].forEach(id => document.getElementById(id).value = '');
    renderTransactionsTable();
};

function renderTransactionsTable() {
    const list = document.getElementById('full-transactions-list');
    const rows = getFilteredTransactions();
    list.innerHTML = '';
    if (rows.length === 0) {
        list.innerHTML = allTransactions.length === 0
            ? emptyStateRow(5, dataLoaded ? "Aucune opération pour l'instant" : 'Chargement…', dataLoaded)
            : `<tr><td colspan="5" class="p-6 text-center text-slate-500">Aucun résultat. <button type="button" onclick="resetFilters()" class="text-blue-600 underline">Effacer les filtres</button></td></tr>`;
    } else rows.forEach(t => list.appendChild(createTransactionRow(t, true)));

    const inc = rows.filter(t => t.type === 'loyer').reduce((s, t) => s + t.amount, 0);
    const out = rows.filter(t => t.type !== 'loyer').reduce((s, t) => s + t.amount, 0);
    const bal = inc - out;
    document.getElementById('filter-summary').innerHTML = `
        <span class="font-semibold text-slate-700">${rows.length} opération${rows.length > 1 ? 's' : ''}${isFiltered() ? ` <button type="button" onclick="resetFilters()" class="ml-1 text-blue-600 font-normal underline">effacer</button>` : ''}</span>
        <span class="text-green-600">Entrées <strong>+${formatMontantCourt(inc)}</strong></span>
        <span class="text-red-600">Sorties <strong>-${formatMontantCourt(out)}</strong></span>
        <span class="${bal >= 0 ? 'text-blue-700' : 'text-red-700'}">Solde <strong>${formatMontantCourt(bal)}</strong></span>`;
}
window.renderTransactionsTable = renderTransactionsTable;

function createTransactionRow(t, isFullTable) {
    const tr = document.createElement('tr');
    const sign = (t.type === 'loyer') ? '+' : '-';
    const typeBadge = categoryBadge(t.type), amountColor = catInfo(t.type).amount;

    // Badge d'assignation
    const assigneeBadge = (t.assigned === 'locataire') 
        ? `<span class="mt-1 inline-block text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded uppercase tracking-wider border border-blue-200"><i class="fa-solid fa-user"></i> Locataire</span>`
        : `<span class="mt-1 inline-block text-[10px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded uppercase tracking-wider border border-purple-200"><i class="fa-solid fa-user-tie"></i> Propriétaire</span>`;

    const displayDate = formatDateFr(t.date);
    
    let actionHtml = '<span class="text-slate-300">-</span>';
    if (isFullTable) {
        actionHtml = `
            <div class="flex flex-col sm:flex-row justify-center items-center gap-0 sm:gap-1">
                ${t.type === 'loyer' ? `<button onclick="openQuittanceFor('${t.date.slice(0, 7)}')" class="text-red-500 hover:text-red-700 p-2 rounded hover:bg-red-50 transition" title="Quittance de ce mois"><i class="fa-solid fa-file-pdf"></i></button>` : ''}
                <button onclick="editTransaction('${t.id}')" class="text-blue-500 hover:text-blue-700 p-2 rounded hover:bg-blue-50 transition" title="Modifier"><i class="fa-solid fa-pen"></i></button>
                <button onclick="duplicateTransaction('${t.id}')" class="text-emerald-500 hover:text-emerald-700 p-2 rounded hover:bg-emerald-50 transition" title="Dupliquer"><i class="fa-solid fa-copy"></i></button>
                <button onclick="deleteTransaction('${t.id}')" class="text-red-500 hover:text-red-700 p-2 rounded hover:bg-red-50 transition" title="Supprimer"><i class="fa-solid fa-trash"></i></button>
            </div>`;
    }

    tr.innerHTML = `
        <td class="p-2 sm:p-3 text-slate-700 whitespace-nowrap text-xs sm:text-sm"><span class="sm:hidden">${displayDate.slice(0, 6) + displayDate.slice(8)}</span><span class="hidden sm:inline">${displayDate}</span></td>
        <td class="p-3 hidden sm:table-cell">${typeBadge}</td>
        <td class="p-2 sm:p-3 text-slate-700 font-medium leading-tight break-words"><div class="sm:hidden mb-1">${typeBadge}</div>${escapeHtml(t.desc)}<br>${assigneeBadge}</td>
        <td class="p-2 sm:p-3 text-right whitespace-nowrap ${amountColor}">${sign}&nbsp;${formatMontantCourt(t.amount)}</td>
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

let toastTimer = null;
// action (facultatif) : { label, onClick, duration }
function showToast(message, isError = false, action = null) {
    const toast = document.getElementById('toast'), icon = document.getElementById('toast-icon'), btn = document.getElementById('toast-action');
    document.getElementById('toast-msg').innerText = message;
    const base = "opacity-0 transition-opacity duration-300 fixed top-6 right-6 px-4 py-3 rounded-lg font-medium text-sm flex items-center gap-2 shadow-lg z-[110] border";
    if (isError) { toast.className = `${base} bg-red-100 text-red-800 border-red-200`; icon.className = "fa-solid fa-circle-exclamation"; }
    else { toast.className = `${base} bg-green-100 text-green-800 border-green-200`; icon.className = "fa-solid fa-check-circle"; }

    btn.classList.toggle('hidden', !action);
    btn.innerText = action ? action.label : '';
    btn.onclick = action ? () => { hideToast(); action.onClick(); } : null;

    clearTimeout(toastTimer);
    void toast.offsetWidth; toast.classList.remove('opacity-0'); toast.classList.add('opacity-100');
    toastTimer = setTimeout(hideToast, action?.duration || 5000);
}
function hideToast() {
    const toast = document.getElementById('toast');
    toast.classList.remove('opacity-100'); toast.classList.add('opacity-0');
    toastTimer = setTimeout(() => toast.classList.add('hidden'), 300);
}

// Montant sans décimales quand elles sont nulles (750 € plutôt que 750,00 €)
function formatMontantCourt(montant) {
    const entier = Math.abs(montant - Math.round(montant)) < 0.005;
    return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: entier ? 0 : 2, maximumFractionDigits: 2 }).format(montant);
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
    data.initiales = escapeHtml((document.getElementById('bailleur_nom').value || 'B').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase());
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
        const row = (label, value, opts = {}) => `<tr style="${opts.bg ? `background:${opts.bg};` : ''}">
            <td style="padding:11px 14px; color:${opts.color || '#334155'}; ${opts.bold ? 'font-weight:700; font-size:15px;' : ''} border-bottom:1px solid #f1f5f9;">${label}</td>
            <td style="padding:11px 14px; text-align:right; color:${opts.color || '#0f172a'}; ${opts.bold ? 'font-weight:800; font-size:16px;' : 'font-weight:600;'} border-bottom:1px solid #f1f5f9;">${value}</td></tr>`;
        const detailHtml = `<tr><th colspan="2" style="text-align:left; padding:0 14px 8px; font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; border-bottom:2px solid #e2e8f0;">Détail du règlement</th></tr>` + (isFull
            ? row('Loyer hors charges', formatMontant(data.loyer_base)) + row('Provisions pour charges', formatMontant(data.loyer_charges)) + row('Total reçu', formatMontant(paid), { bold: true, bg: '#f8fafc' })
            : row('Montant dû (loyer + charges)', formatMontant(data.total)) + row('Montant reçu', formatMontant(paid)) + row('Reste dû', formatMontant(data.total - paid), { bold: true, color: '#b91c1c', bg: '#fef2f2' }));
        const recuText = isFull
            ? `Reçu de <strong>${data.locataire_nom}</strong> la somme de <strong>${formatMontant(paid)}</strong>,
                        au titre du paiement du loyer et des charges du local d'habitation désigné ci-dessus, pour la période du <strong>${periodStartStr}</strong> au <strong>${periodEndStr}</strong>.`
            : `Reçu de <strong>${data.locataire_nom}</strong> la somme de <strong>${formatMontant(paid)}</strong>,
                        à titre d'acompte sur le loyer et les charges du local d'habitation désigné ci-dessus, pour la période du <strong>${periodStartStr}</strong> au <strong>${periodEndStr}</strong>. Ce reçu ne vaut pas quittance.`;
        const mentionText = isFull
            ? `En application de l'article 21 de la loi n° 89-462 du 6 juillet 1989, la présente quittance annule tous les reçus qui auraient pu être donnés pour acompte versé sur le présent terme. <br>
                        Le paiement de la présente quittance n'emporte pas présomption de paiement des termes antérieurs.<br>Sous réserve de tous mes droits pour le passé et l'avenir.`
            : `Paiement partiel : une quittance sera délivrée après règlement intégral du terme.<br>Sous réserve de tous mes droits pour le passé et l'avenir.`;

        const numero = `${isFull ? 'Q' : 'R'}-${year}-${String(monthIdx + 1).padStart(2, '0')}`;
        const accent = isFull ? '#1d4ed8' : '#b45309';
        let pageHtml = `
            <div class="quittance-page">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:24px;">
                    <div style="display:flex; gap:14px; align-items:center; max-width:55%;">
                        <div style="width:54px; height:54px; border-radius:14px; background:${accent}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; font-weight:700; letter-spacing:1px; flex-shrink:0;">${data.initiales}</div>
                        <div>
                            <div style="font-size:15px; font-weight:700; color:#0f172a;">${data.bailleur_nom || 'Le Bailleur'}</div>
                            <div style="font-size:12px; color:#64748b; line-height:1.45; margin-top:2px;">${data.bailleur_adresse}</div>
                        </div>
                    </div>
                    <div style="text-align:right;">
                        <div style="font-size:24px; font-weight:800; color:${accent}; text-transform:uppercase; letter-spacing:.5px; line-height:1.1;">${docTitle}</div>
                        <div style="font-size:12px; color:#64748b; margin-top:6px;">N° <strong style="color:#0f172a;">${numero}</strong></div>
                        <div style="display:inline-block; margin-top:8px; padding:4px 12px; border-radius:999px; background:#f1f5f9; font-size:13px; font-weight:600; color:#334155;">${monthName} ${year}</div>
                    </div>
                </div>

                <div style="height:3px; background:linear-gradient(90deg, ${accent}, #93c5fd); border-radius:3px; margin:26px 0 28px;"></div>

                <div style="display:flex; gap:18px; margin-bottom:28px;">
                    <div style="flex:1; border:1px solid #e2e8f0; border-radius:12px; padding:16px;">
                        <div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Locataire</div>
                        <div style="font-size:15px; font-weight:700; color:#0f172a;">${data.locataire_nom}</div>
                    </div>
                    <div style="flex:1.4; border:1px solid #e2e8f0; border-radius:12px; padding:16px;">
                        <div style="font-size:11px; font-weight:700; color:#94a3b8; text-transform:uppercase; letter-spacing:1px; margin-bottom:6px;">Logement loué</div>
                        <div style="font-size:13px; color:#334155; line-height:1.45;">${data.logement_adresse}</div>
                    </div>
                </div>

                <div style="background:${isFull ? '#eff6ff' : '#fffbeb'}; border:1px solid ${isFull ? '#bfdbfe' : '#fde68a'}; border-radius:14px; padding:20px 22px; display:flex; justify-content:space-between; align-items:center; margin-bottom:24px;">
                    <div>
                        <div style="font-size:12px; font-weight:700; color:${accent}; text-transform:uppercase; letter-spacing:1px;">Montant reçu</div>
                        <div style="font-size:13px; color:#475569; margin-top:4px;">Période du ${periodStartStr} au ${periodEndStr}</div>
                    </div>
                    <div style="font-size:32px; font-weight:800; color:#0f172a;">${formatMontant(paid)}</div>
                </div>

                <p style="font-size:14px; line-height:1.65; color:#334155; text-align:justify; margin:0 0 24px;">${recuText}</p>

                <table style="width:100%; border-collapse:collapse; font-size:14px; margin-bottom:24px;">
                    ${detailHtml}
                </table>

                <p style="font-size:11px; line-height:1.55; color:#94a3b8; font-style:italic; margin:0 0 30px;">${mentionText}</p>

                <div style="display:flex; justify-content:flex-end;">
                    <div style="width:290px; text-align:right;">
                        <div style="font-size:13px; color:#475569;">Fait à <strong style="color:#0f172a;">${data.lieu_emission}</strong>, le <strong style="color:#0f172a;">${dateGeneration}</strong></div>
                        <div style="font-size:13px; color:#475569; margin:10px 0 8px;">Le Bailleur,</div>
                        ${data.signature ? `<img src="${data.signature}" style="max-width:200px; max-height:95px; margin-left:auto; display:block;" alt="Signature">` : '<div style="height:80px; border:1px dashed #cbd5e1; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:12px;">Signature</div>'}
                        <div style="font-size:13px; font-weight:600; color:#0f172a; margin-top:6px;">${data.bailleur_nom}</div>
                    </div>
                </div>

                <div style="position:absolute; left:60px; right:60px; bottom:36px; border-top:1px solid #e2e8f0; padding-top:10px; display:flex; justify-content:space-between; font-size:10px; color:#94a3b8;">
                    <span>${docTitle} n° ${numero}</span>
                    <span>Émise le ${dateGeneration}</span>
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

// --- APERÇU AVANT TÉLÉCHARGEMENT ---
const PAGE_W = 794, PAGE_H = 1120; // A4 à 96 dpi
let previewResult = null;

function layoutPreview() {
    const box = document.getElementById('preview-pages');
    const scale = Math.min(1, (box.clientWidth - 24) / PAGE_W);
    box.querySelectorAll('.preview-frame').forEach(f => {
        f.style.width = PAGE_W * scale + 'px'; f.style.height = PAGE_H * scale + 'px';
        f.firstElementChild.style.transform = `scale(${scale})`;
    });
}
window.addEventListener('resize', () => { if (previewResult) layoutPreview(); });

function openQuittancePreview() {
    const r = buildQuittances();
    if (!r) return;
    previewResult = r;
    const box = document.getElementById('preview-pages');
    box.innerHTML = '';
    document.querySelectorAll('#pdf-workspace .quittance-page').forEach(page => {
        const frame = document.createElement('div');
        frame.className = 'preview-frame mx-auto bg-white shadow-md rounded overflow-hidden';
        const inner = page.cloneNode(true);
        inner.style.transformOrigin = 'top left';
        frame.appendChild(inner);
        box.appendChild(frame);
    });
    document.getElementById('preview-summary').innerText = quittanceSummary(r);
    document.getElementById('preview-modal').classList.remove('hidden');
    requestAnimationFrame(layoutPreview);
}
window.closePreview = function() {
    document.getElementById('preview-modal').classList.add('hidden');
    document.getElementById('preview-pages').innerHTML = '';
    document.getElementById('pdf-workspace').innerHTML = '';
    previewResult = null;
};
window.downloadFromPreview = async function() {
    if (!previewResult) return;
    const r = previewResult, btn = document.getElementById('preview-download');
    btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Création…';
    try {
        await renderWorkspacePdf(w => w.set({ filename: r.filename }).save());
        showToast("PDF téléchargé : " + quittanceSummary(r));
        closePreview();
    } catch (error) { showToast("Erreur création PDF.", true); }
    finally { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-download"></i> Télécharger le PDF'; }
};
window.sendFromPreview = function() { closePreview(); sendQuittances(); };

// Raccourcis pour un mois précis (tableau de bord, historique, après encaissement)
window.openQuittanceFor = function(monthKey) {
    document.getElementById('date_debut').value = monthKey;
    document.getElementById('date_fin').value = monthKey;
    openQuittancePreview();
};
window.sendQuittanceFor = function(monthKey) {
    document.getElementById('date_debut').value = monthKey;
    document.getElementById('date_fin').value = monthKey;
    sendQuittances();
};

document.getElementById('btn-generate').addEventListener('click', openQuittancePreview);

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

document.getElementById('btn-generate-email').addEventListener('click', () => sendQuittances());

function sendQuittances() {
    const email = document.getElementById('locataire_email').value;
    if (!email) { showToast("Attention: Renseignez l'email du locataire dans l'onglet 'Bail'", true); switchTab('locataire'); return; }
    if (!document.getElementById('google_client_id').value) { showToast("L'ID Client Google est manquant pour l'envoi direct.", true); switchTab('locataire'); return; }

    const dDeb = document.getElementById('date_debut').value, dFin = document.getElementById('date_fin').value;
    const subject = dDeb === dFin ? `Votre quittance de loyer – ${monthLabel(dDeb)}` : `Vos quittances de loyer – ${monthLabel(dDeb)} à ${monthLabel(dFin)}`;
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
        showToast("Préparation du PDF…");
        try {
            const pdfDataUri = await renderWorkspacePdf(w => w.outputPdf('datauristring'));
            await sendEmailViaGmailAPI(email, subject, body, pdfDataUri, r2.filename);
        } catch (err) { showToast("Erreur lors de la préparation de la pièce jointe.", true); }
        finally { setPdfBusy(btn, false); }
    }, { confirmLabel: "Oui, envoyer l'email", confirmIcon: 'fa-paper-plane', extraLabel: 'Voir l\'aperçu', onExtra: () => openQuittancePreview() });
}

window.sendRelanceEmail = function() {
    const email = document.getElementById('locataire_email').value;
    if (!email) { showToast("Veuillez renseigner l'email du locataire au-dessus.", true); return; }
    const total = (parseFloat(document.getElementById('loyer_base').value) || 0) + (parseFloat(document.getElementById('loyer_charges').value) || 0);
    const subject = `Relance : Retard de paiement de loyer`;
    const body = `Bonjour ${document.getElementById('locataire_nom').value || 'Locataire'},\n\nSauf erreur ou omission de ma part, je n'ai pas encore reçu le paiement de votre loyer d'un montant de ${formatMontant(total)} pour le mois en cours.\n\nJe vous remercie de bien vouloir procéder au règlement dans les plus brefs délais.\n\nSi vous avez déjà effectué le paiement entre-temps, veuillez ne pas tenir compte de ce message.\n\nCordialement,\n${document.getElementById('bailleur_nom').value || 'Le Bailleur'}`;

    showConfirmModal("Avertissement : Envoi de Relance", `Vous allez envoyer un email de relance d'impayé à <strong>${escapeHtml(email)}</strong>. Relisez l'aperçu ci-dessous :`, `<strong>Sujet :</strong> ${subject}<br><br><strong>Message :</strong><br>${escapeHtml(body).replace(/\n/g, '<br>')}`, () => { sendEmailViaGmailAPI(email, subject, body, null); });
};
