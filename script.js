// =================================================================================
// ========================== 1. EVENT LISTENERS ===================================
// =================================================================================
// Assigns actions to HTML elements, like input formatting and button clicks.
// ---------------------------------------------------------------------------------

/**
 * Attaches an event listener to the CNPJ input field to format the value as a CNPJ mask
 * automatically while the user is typing.
 */
document.getElementById('cnpjInput').addEventListener('input', function(e) {
    // Re-formats the input value to match the ##.###.###/####-## pattern
    e.target.value = formatarCNPJ(e.target.value);
});

/**
 * Attaches an event listener to the CNPJ input field to trigger the consultation
 * when the user presses the "Enter" key.
 */
document.getElementById('cnpjInput').addEventListener('keypress', e => {
    // If the pressed key is 'Enter', call the main consultation function
    if (e.key === 'Enter') {
        consultarCNPJ();
    }
});


// =================================================================================
// ========================== 2. MAIN CONSULTATION LOGIC ===========================
// =================================================================================
// This is the core function that orchestrates the CNPJ consultation process.
// ---------------------------------------------------------------------------------

/**
 * The main async function that controls the entire CNPJ lookup process.
 * It validates the input, shows loading indicators, fetches data from two different
 * APIs, and coordinates the rendering of the results.
 */
async function consultarCNPJ() {
    const cnpjInput = document.getElementById('cnpjInput').value;
    const cnpjLimpo = limparCNPJ(cnpjInput); // Clean the CNPJ for API usage

    // Get references to DOM elements
    const resultsSection = document.getElementById('resultsSection');
    const loadingDiv = document.getElementById('loadingDiv');
    const resultsDiv = document.getElementById('resultsDiv');

    // Clear previous results and validate the new CNPJ
    resultsDiv.innerHTML = '';
    if (!cnpjLimpo) {
        mostrarErro('Por favor, digite um CNPJ.');
        return;
    }
    if (!validarCNPJ(cnpjLimpo)) {
        mostrarErro('CNPJ inválido! Verifique os números digitados.');
        return;
    }

    // Show the results section and the loading spinner
    resultsSection.classList.add('show');
    loadingDiv.style.display = 'block';

    try {
        // --- Primary API Call ---
        // Fetch from CNPJ.A first, as it's the primary source of data.
        const cnpjaData = await consultarCNPJA_API(cnpjLimpo);

        // Hide the loading spinner once the primary data is fetched
        loadingDiv.style.display = 'none';

        // Check if the primary API call was successful
        if (!cnpjaData) {
            mostrarErro('Não foi possível obter os dados principais da empresa. A API pode estar indisponível.');
            return;
        }

        // Render the initial card with the data we have so far
        renderInitialCard(cnpjaData, resultsDiv);
        foldTopSection(); // Collapse the top search section for better visibility

        // --- Secondary API Call (Non-blocking) ---
        // Fetch data from ReceitaWS in the background without blocking the UI.
        // This allows the user to see the primary info immediately.
        consultarReceitaWS(cnpjLimpo).then(receitaWSData => {
            if (receitaWSData) {
                // If successful, merge and update the UI with the new data
                updateCardWithReceitaWSData(cnpjaData, receitaWSData);
            } else {
                // Handle the case where ReceitaWS fails but CNPJA succeeded.
                // This ensures placeholders are correctly handled.
                updateCardWithReceitaWSData(cnpjaData, null);
            }
        });

    } catch (error) {
        // Catch any critical errors during the primary API call
        loadingDiv.style.display = 'none';
        mostrarErro('Erro na consulta principal: ' + error.message);
    }
}


// =================================================================================
// ========================== 3. API FETCH FUNCTIONS ===============================
// =================================================================================
// These functions are responsible for making network requests to the external APIs.
// ---------------------------------------------------------------------------------

/**
 * Fetches company data from the open.cnpja.com API.
 * This is the primary data source.
 * @param {string} cnpj - The clean, numbers-only CNPJ.
 * @returns {Promise<object|null>} A promise that resolves to the JSON data or null if it fails.
 */
async function consultarCNPJA_API(cnpj) {
    try {
        const response = await fetch(`https://open.cnpja.com/office/${cnpj}`);
        if (response.ok) {
            return await response.json();
        }
        return null; // Return null if response is not OK (e.g., 404)
    } catch (error) {
        console.error('Erro na CNPJA API:', error);
        return null; // Return null on network or other errors
    }
}

/**
 * Fetches supplementary company data from the receitaws.com.br API.
 * This is used for tax regime and secondary activities. It uses a CORS proxy.
 * @param {string} cnpj - The clean, numbers-only CNPJ.
 * @returns {Promise<object|null>} A promise that resolves to the JSON data or null if it fails.
 */
async function consultarReceitaWS(cnpj) {
    try {
        // Using a CORS proxy to bypass browser security restrictions on cross-origin requests
        const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`)}`);
        if (response.ok) {
            // The proxy wraps the actual response, so we need to parse it
            const result = JSON.parse((await response.json()).contents);
            if (result.status !== "ERROR") {
                return result;
            }
        }
        return null;
    } catch (error) {
        console.error('Erro na ReceitaWS API:', error);
        return null;
    }
}


// =================================================================================
// ==================== 4. DYNAMIC UI RENDERING & UPDATING =========================
// =================================================================================
// Functions that build and update the main HTML structure of the results card.
// ---------------------------------------------------------------------------------

/**
 * Renders the initial company card with data from the first API (CNPJ.A).
 * Includes placeholders for data that will be loaded from the second API.
 * @param {object} data - The data object from the CNPJA_API call.
 * @param {HTMLElement} container - The container element to inject the HTML into.
 */
function renderInitialCard(data, container) {
    const company = data.company || {};
    const address = data.address || {};
    // Map status IDs to user-friendly text and CSS classes
    const statusMap = {
        1: { text: 'Ativa', class: 'status-active' },
        2: { text: 'Ativa', class: 'status-active' },
        3: { text: 'Suspensa', class: 'status-warning' },
        4: { text: 'Inapta', class: 'status-warning' },
        8: { text: 'Baixada', class: 'status-inactive' }
    };
    const statusInfo = statusMap[data.status?.id] || { text: 'Desconhecido', class: 'status-warning' };

    // Generate complex HTML sections using helper functions
    const ieHTML = gerarIEHTML(data.registrations, address.state);
    const sociosHTML = gerarSociosHTML(company.members);
    const contatoHTML = gerarContatoHTML(data.phones, data.emails);
    const secondGridHTML = (ieHTML || sociosHTML) ? `<div class="info-grid">${ieHTML}${sociosHTML}</div>` : '';

    // The main template for the results card. Uses placeholders for secondary data.
    container.innerHTML = `
        <div class="company-card">
            <div class="company-header">
                <div class="company-info-left">
                    <div class="company-name">${data.alias || company.name || 'N/A'}</div>
                    <div class="company-cnpj copyable" onclick="copyToClipboard(this)">${formatarCNPJ(data.taxId || '')}</div>
                </div>
                <div class="status-container">
                    <!-- Placeholder for Tax Regime, to be filled by the second API -->
                    <div id="tax-regime-placeholder"><div class="mini-spinner"></div></div>
                    <div class="status-badge ${statusInfo.class}">${statusInfo.text}</div>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-card">
                    <h3>📋 Informações Básicas</h3>
                    <p><strong>Razão Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${company.name || 'N/A'}</span></p>
                    <p><strong>Nome Fantasia:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.alias || 'N/A'}</span></p>
                    <p><strong>Data de Abertura:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarData(data.founded) || 'N/A'}</span></p>
                    <p><strong>Porte:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${company.size?.text || 'N/A'}</span></p>
                    <p><strong>Capital Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarCapital(company.equity)}</span></p>
                </div>
                <div class="info-card" id="economic-activity-card">
                    <h3>🏭 Atividade Econômica</h3>
                    <p><strong>Atividade Principal:</strong></p>
                    <p>${data.mainActivity?.text || 'N/A'}</p>
                    <p><strong>Código CNAE:</strong> ${data.mainActivity?.id || 'N/A'}</p>
                    <p><strong>Natureza Jurídica:</strong> ${data.legalNature?.text || 'N/A'}</p>
                    <!-- Placeholder for Secondary Activities -->
                    <div id="secondary-activities-placeholder"><div class="placeholder-loading"></div></div>
                </div>
                <div class="info-card">
                    <h3>📍 Endereço</h3>
                    <p><strong>Logradouro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.street || 'N/A'}</span></p>
                    <p><strong>Número:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.number || 'S/N'}</span></p>
                    ${address.details ? `<p><strong>Complemento:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.details}</span></p>` : ''}
                    <p><strong>Bairro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.district || 'N/A'}</span></p>
                    <p><strong>Cidade/UF:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.city || 'N/A'}</span> / <span class="copyable" onclick="copyToClipboard(this)">${address.state || 'N/A'}</span></p>
                    <p><strong>CEP:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.zip || 'N/A'}</span></p>
                </div>
                <div class="info-card">
                    <h3>📞 Contato</h3>
                    ${contatoHTML}
                </div>
            </div>
            ${secondGridHTML}
        </div>
    `;
}

/**
 * Updates the card with data from the second API (ReceitaWS) once it's available.
 * It finds the placeholders in the DOM and replaces them with the new data.
 * @param {object} cnpjaData - The original data from the primary API.
 * @param {object|null} receitaWSData - The data from the secondary API, or null if it failed.
 */
function updateCardWithReceitaWSData(cnpjaData, receitaWSData) {
    // Merge data from both sources for easier access
    const mergedData = {
        ...cnpjaData,
        simples: receitaWSData?.simples,
        simei: receitaWSData?.simei,
        atividades_secundarias_receitaws: receitaWSData?.atividades_secundarias,
    };

    // Update Tax Regime in its placeholder
    const taxPlaceholder = document.getElementById('tax-regime-placeholder');
    if (taxPlaceholder) {
        const taxRegimeInfo = getTaxRegimeInfo(mergedData);
        taxPlaceholder.innerHTML = `<div class="${taxRegimeInfo.class}">${taxRegimeInfo.text}</div>`;
    }

    // Update Secondary Activities in its placeholder
    const activitiesPlaceholder = document.getElementById('secondary-activities-placeholder');
    if (activitiesPlaceholder) {
        // Prefer ReceitaWS data for secondary activities, but fall back to CNPJ.A data
        const secundarias = mergedData.atividades_secundarias_receitaws || cnpjaData.company?.sideActivities;
        activitiesPlaceholder.innerHTML = gerarAtividadesSecundariasHTML(secundarias);
    }
}


// =================================================================================
// ==================== 5. HTML STRING GENERATION HELPERS ==========================
// =================================================================================
// Functions that generate specific, smaller pieces of HTML for the results card.
// ---------------------------------------------------------------------------------

/**
 * Determines the company's tax regime (Simples, SIMEI, or Normal/Outros).
 * @param {object} data - The merged data from both APIs.
 * @returns {{text: string, class: string}} An object with the display text and CSS class.
 */
function getTaxRegimeInfo(data) {
    if (data.simei?.optante === true) return { text: 'S I M E I', class: 'tax-regime-bar' };
    if (data.simples?.optante === true || data.simples?.opcao_pelo_simples === 'SIM') return { text: 'Simples', class: 'tax-regime-bar' };
    if (data.simples || data.simei) return { text: 'Trib: Normal', class: 'tax-regime-bar' };
    // Default if no data is available
    return { text: 'Trib: Outros', class: 'tax-regime-bar' };
}

/**
 * Creates the HTML for the secondary activities section, including a "show more" toggle.
 * @param {Array<object>} activities - An array of secondary activity objects.
 * @returns {string} The generated HTML string.
 */
function gerarAtividadesSecundariasHTML(activities) {
    if (!activities || activities.length === 0) {
        return '<p style="margin-top: 12px;"><strong>Atividades Secundárias:</strong><br>Nenhuma encontrada.</p>';
    }
    const total = activities.length;
    const limit = 2; // Number of activities to show by default
    const createActivityHTML = a => `<p class="activity-item">• ${a.text || 'N/A'} (${a.code || a.id || 'N/A'})</p>`;
    
    const visibleHtml = activities.slice(0, limit).map(createActivityHTML).join('');
    let hiddenHtml = '', toggleButtonHtml = '';

    // If there are more activities than the limit, create the hidden container and toggle button
    if (total > limit) {
        const remaining = activities.slice(limit);
        hiddenHtml = `<div id="hidden-activities" class="hidden">${remaining.map(createActivityHTML).join('')}</div>`;
        toggleButtonHtml = `<p id="toggle-activities-btn" class="toggle-link" data-remaining-count="${remaining.length}" onclick="toggleSecondaryActivities()">Ver mais ${remaining.length}...</p>`;
    }
    
    return `
        <div class="secondary-activities-container">
            <p><strong>Atividades Secundárias (${total}):</strong></p>
            ${visibleHtml}${hiddenHtml}${toggleButtonHtml}
        </div>
    `;
}

/**
 * Creates the HTML for the contact information (phones and emails).
 * @param {Array<object>} phones - An array of phone objects.
 * @param {Array<object>} emails - An array of email objects.
 * @returns {string} The generated HTML string.
 */
function gerarContatoHTML(phones, emails) {
    let html = '';
    // Add up to 2 phone numbers
    if (phones?.length > 0) {
        html += phones.slice(0, 2).map((p, i) => `<p><strong>Telefone ${i + 1}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarTelefone(p.number)}</span></p>`).join('');
    } else {
        html += '<p><strong>Telefone:</strong><br><span class="copyable" onclick="copyToClipboard(this)">N/A</span></p>';
    }
    // Add up to 2 email addresses
    if (emails?.length > 0) {
        html += emails.slice(0, 2).map((e, i) => `<p><strong>Email ${i + 1}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${e.address || 'N/A'}</span></p>`).join('');
    } else {
        html += '<p><strong>Email:</strong><br><span class="copyable" onclick="copyToClipboard(this)">N/A</span></p>';
    }
    return html;
}

/**
 * Creates the HTML for the state registrations (Inscrições Estaduais) card.
 * @param {Array<object>} registrations - An array of registration objects.
 * @param {string} mainState - The primary state of the company's address to highlight.
 * @returns {string} The generated HTML string, or an empty string if none.
 */
function gerarIEHTML(registrations, mainState) {
    if (!registrations || registrations.length === 0) return '';

    let html = `<div class="info-card"><h3>🎯 Inscrições Estaduais</h3><div class="ie-list">`;
    registrations.forEach(reg => {
        const classes = ['ie-item'];
        if (!reg.enabled) classes.push('inactive');
        // Highlight the registration that matches the main company address state
        if (mainState && reg.state?.toUpperCase() === mainState.toUpperCase()) {
            classes.push(reg.enabled ? 'highlighted-active' : 'highlighted-inactive');
        }
        html += `
            <div class="${classes.join(' ')}">
                <p><strong>IE ${reg.state}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${reg.number || 'N/A'}</span></p>
                <p><strong>Status:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${reg.status?.text || 'Desconhecido'}</span></p>
            </div>`;
    });
    html += '</div></div>';
    return html;
}

/**
 * Creates the HTML for the company members (Quadro Societário) card.
 * @param {Array<object>} members - An array of member objects.
 * @returns {string} The generated HTML string, or an empty string if none.
 */
function gerarSociosHTML(members) {
    if (!members || members.length === 0) return '';

    let html = `<div class="info-card"><h3>👥 Quadro Societário (${members.length})</h3>`;
    // Show the first 8 members
    html += members.slice(0, 8).map(m => `<p>• ${m.person?.name || 'N/A'} <br><em>${m.role?.text || 'Sócio'}</em></p>`).join('');
    // If there are more, add a summary line
    if (members.length > 8) {
        html += `<p><em>... e mais ${members.length - 8} membros.</em></p>`;
    }
    html += '</div>';
    return html;
}


// =================================================================================
// ================== 6. DATA FORMATTING & VALIDATION UTILITIES ====================
// =================================================================================
// Helper functions for cleaning, formatting, and validating data (especially CNPJ).
// ---------------------------------------------------------------------------------

/** Removes all non-numeric characters from a CNPJ string. */
function limparCNPJ(cnpj) {
    return cnpj.replace(/[^0-9]/g, '');
}

/** Formats a clean CNPJ string into the standard ##.###.###/####-## format. */
function formatarCNPJ(cnpj) {
    const cnpjLimpo = limparCNPJ(cnpj);
    return cnpjLimpo.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/** Formats a phone number string into a standard (##) #####-#### format. */
function formatarTelefone(telefone) {
    if (!telefone) return 'N/A';
    const num = telefone.replace(/\D/g, '');
    if (num.length === 11) return `(${num.substring(0,2)}) ${num.substring(2,7)}-${num.substring(7)}`;
    if (num.length === 10) return `(${num.substring(0,2)}) ${num.substring(2,6)}-${num.substring(6)}`;
    return telefone; // Return original if format is not recognized
}

/** Formats a date string into the Brazilian pt-BR locale format (DD/MM/YYYY). */
function formatarData(data) {
    if (!data) return null;
    return new Date(data).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

/** Formats a number into a Brazilian Real (R$) currency string. */
function formatarCapital(capital) {
    if (capital === null || capital === undefined) return 'N/A';
    return `R$ ${parseFloat(capital).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Validates a CNPJ number using the official Brazilian algorithm.
 * @param {string} cnpj - The CNPJ to validate (can be formatted or clean).
 * @returns {boolean} True if the CNPJ is valid, false otherwise.
 */
function validarCNPJ(cnpj) {
    const cnpjLimpo = limparCNPJ(cnpj);

    // Basic checks: length and all-same-digit sequence (e.g., 11.111.111/1111-11)
    if (cnpjLimpo.length !== 14 || /^(\d)\1+$/.test(cnpjLimpo)) return false;

    // --- Verification Digit 1 ---
    let tamanho = cnpjLimpo.length - 2;
    let numeros = cnpjLimpo.substring(0, tamanho);
    let digitos = cnpjLimpo.substring(tamanho);
    let soma = 0;
    let pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
        if (pos < 2) pos = 9;
    }
    let resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);
    if (resultado !== parseInt(digitos.charAt(0), 10)) return false;

    // --- Verification Digit 2 ---
    tamanho += 1;
    numeros = cnpjLimpo.substring(0, tamanho);
    soma = 0;
    pos = tamanho - 7;
    for (let i = tamanho; i >= 1; i--) {
        soma += parseInt(numeros.charAt(tamanho - i), 10) * pos--;
        if (pos < 2) pos = 9;
    }
    resultado = soma % 11 < 2 ? 0 : 11 - (soma % 11);

    // Final check
    return resultado === parseInt(digitos.charAt(1), 10);
}


// =================================================================================
// ==================== 7. UI INTERACTION & FEEDBACK ===============================
// =================================================================================
// Functions that manage UI state, animations, and user feedback actions.
// ---------------------------------------------------------------------------------

/** Hides the top search section and shows the "unfold" button. */
function foldTopSection() {
    document.getElementById('topSectionWrapper').classList.add('folded');
    document.getElementById('unfoldButtonContainer').style.display = 'block';
}

/** Toggles the visibility of the top search section. */
function toggleTopSection() {
    document.getElementById('topSectionWrapper').classList.toggle('folded');
}

/** Toggles the visibility of hidden secondary activities and updates the button text. */
function toggleSecondaryActivities() {
    const hiddenActivities = document.getElementById('hidden-activities');
    const toggleBtn = document.getElementById('toggle-activities-btn');
    if (!hiddenActivities || !toggleBtn) return;

    hiddenActivities.classList.toggle('hidden');
    const isHidden = hiddenActivities.classList.contains('hidden');
    // Update button text based on visibility
    toggleBtn.innerHTML = isHidden ? `Ver mais ${toggleBtn.dataset.remainingCount}...` : 'Ver menos';
}

/**
 * Copies the text content of a given HTML element to the clipboard and provides
 * visual feedback to the user.
 * @param {HTMLElement} element - The element whose innerText will be copied.
 */
function copyToClipboard(element) {
    const textToCopy = element.innerText?.toUpperCase();
    if (!textToCopy || textToCopy === 'N/A') return; // Don't copy empty or N/A values

    navigator.clipboard.writeText(textToCopy).then(() => {
        const originalHTML = element.innerHTML;
        element.innerHTML = '✅ Copiado!'; // Provide success feedback
        setTimeout(() => { element.innerHTML = originalHTML; }, 1200); // Revert after a delay
    }).catch(err => console.error('Falha ao copiar:', err));
}

/**
 * Displays an error message in the results area.
 * @param {string} mensagem - The error message to display.
 */
function mostrarErro(mensagem) {
    const resultsSection = document.getElementById('resultsSection');
    const resultsDiv = document.getElementById('resultsDiv');
    resultsDiv.innerHTML = `<div class="error-message">❌ ${mensagem}</div>`;
    resultsSection.classList.add('show'); // Ensure the results section is visible
    foldTopSection(); // Hide the search bar to show the error clearly
}