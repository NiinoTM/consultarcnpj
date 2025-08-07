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
 * The main async function that orchestrates the CNPJ consultation process.
 * It initiates calls to THREE APIs concurrently: ReceitaWS (primary),
 * CNPJ.A (secondary), and MinhaReceita (secondary). It displays data from
 * whichever API responds first, and then updates the card if the primary
 * source (ReceitaWS) arrives later.
 */
async function consultarCNPJ() {
    const cnpjInput = document.getElementById('cnpjInput').value;
    const cnpjLimpo = limparCNPJ(cnpjInput);

    const resultsSection = document.getElementById('resultsSection');
    const loadingDiv = document.getElementById('loadingDiv');
    const resultsDiv = document.getElementById('resultsDiv');

    // 1. Initial Setup and Validation
    resultsDiv.innerHTML = '';
    if (!cnpjLimpo || !validarCNPJ(cnpjLimpo)) {
        mostrarErro(!cnpjLimpo ? 'Por favor, digite um CNPJ.' : 'CNPJ inválido! Verifique os números digitados.');
        return;
    }

    resultsSection.classList.add('show');
    loadingDiv.style.display = 'block';
    foldTopSection();

    // 2. State management for the three-way race
    let cnpjaDataCache = null;
    let receitaWsDataCache = null;
    let minhaReceitaDataCache = null;
    let hasRendered = false;
    let failedApiCount = 0;
    const TOTAL_APIS = 3;

    // 3. Define handler functions for API responses

    const handleFailure = (apiName) => {
        console.error(`${apiName} API failed or returned no data.`);
        failedApiCount++;
        // If all APIs have failed, show the final error message
        if (failedApiCount === TOTAL_APIS) {
            loadingDiv.style.display = 'none';
            mostrarErro('Todas as fontes de dados falharam. Tente novamente mais tarde.');
        }
    };

    // --- Handler for CNPJ.A (Secondary) ---
    const handleCnpjaResponse = (data) => {
        if (!data) return handleFailure('CNPJA');
        console.log("CNPJ.A data arrived.");
        cnpjaDataCache = data;

        if (receitaWsDataCache) { // If primary is already rendered, just update IE
            updateCardWithIEData(cnpjaDataCache, receitaWsDataCache.uf);
        } else if (!hasRendered) { // Otherwise, if we're first, render ourselves
            loadingDiv.style.display = 'none';
            hasRendered = true;
            console.log("Rendering fallback data from CNPJ.A.");
            renderCardFromCNPJA(data, resultsDiv);
            addWarningMessage("Exibindo dados preliminares. Atualizando com a fonte principal...");
        }
    };

    // --- Handler for MinhaReceita (Secondary) ---
    const handleMinhaReceitaResponse = (data) => {
        if (!data) return handleFailure('MinhaReceita');
        console.log("MinhaReceita data arrived.");
        minhaReceitaDataCache = data;

        if (!receitaWsDataCache && !hasRendered) { // If we are first, render
            loadingDiv.style.display = 'none';
            hasRendered = true;
            console.log("Rendering fallback data from MinhaReceita.");
            renderCardFromMinhaReceita(data, resultsDiv);
            addWarningMessage("Exibindo dados preliminares. Atualizando com a fonte principal...");
        }
    };

    // --- Handler for ReceitaWS (Primary Source of Truth) ---
    const handleReceitaWsResponse = (data) => {
        if (!data) return handleFailure('ReceitaWS');
        loadingDiv.style.display = 'none';
        hasRendered = true; // Mark as rendered (or re-rendered)
        console.log("ReceitaWS data arrived. Rendering primary data.");
        receitaWsDataCache = data;

        // ALWAYS render with ReceitaWS data, as it's the source of truth
        renderCardFromReceitaWS(data, resultsDiv);
        // Use cached CNPJ.A data to fill in IE if it has already arrived
        updateCardWithIEData(cnpjaDataCache, receitaWsDataCache.uf);
    };

    // 4. Initiate ALL THREE API calls concurrently to start the race
    consultarCNPJA_API(cnpjLimpo).then(handleCnpjaResponse);
    consultarReceitaWS(cnpjLimpo).then(handleReceitaWsResponse);
    consultarMinhaReceitaAPI(cnpjLimpo).then(handleMinhaReceitaResponse);
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
    const MAX_RETRIES = 3; // Total number of attempts
    const RETRY_DELAY_MS = 1500; // Wait 1.5 seconds between attempts

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // Using a CORS proxy to bypass browser security restrictions
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://www.receitaws.com.br/v1/cnpj/${cnpj}`)}`);

            if (response.ok) {
                const result = JSON.parse((await response.json()).contents);

                // The ReceitaWS API can return a 200 OK status but with an internal error message.
                // We must check for this "status: ERROR" in the response body.
                if (result.status !== "ERROR") {
                    return result; // Success! Return the data immediately.
                } else {
                    // API returned a known error state. Log it and prepare to retry.
                    console.warn(`Attempt ${attempt}: ReceitaWS API returned status: ERROR. Retrying...`);
                }
            } else {
                // The request itself failed (e.g., HTTP 404, 500, or CORS proxy error).
                console.warn(`Attempt ${attempt}: ReceitaWS API request failed with HTTP status ${response.status}. Retrying...`);
            }
        } catch (error) {
            // A network error occurred (e.g., user is offline).
            console.error(`Attempt ${attempt}: Error during ReceitaWS API fetch:`, error);
        }

        // If the code reaches this point, the attempt failed.
        // Wait before the next attempt, but not after the final one.
        if (attempt < MAX_RETRIES) {
            await delay(RETRY_DELAY_MS);
        }
    }

    // If the loop completes without returning, all attempts have failed.
    console.error(`All ${MAX_RETRIES} attempts to fetch data from ReceitaWS failed for CNPJ ${cnpj}.`);
    return null; // Return null to indicate final failure
}

/**
 * Fetches company data from the minhareceita.org API.
 * This is a secondary data source. Includes a retry mechanism.
 * @param {string} cnpj - The clean, numbers-only CNPJ.
 * @returns {Promise<object|null>} A promise that resolves to the JSON data or null if it fails.
 */
async function consultarMinhaReceitaAPI(cnpj) {
    const MAX_RETRIES = 2; // This API can be slower, so fewer retries
    const RETRY_DELAY_MS = 1500;
    const cleanCNPJ = limparCNPJ(cnpj); // Ensure only numbers are used

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            // This API uses a different URL structure
            const response = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(`https://minhareceita.org/${cleanCNPJ}`)}`);
            if (response.ok) {
                const result = JSON.parse((await response.json()).contents);
                // Check for a valid response, which should have a cnpj field
                if (result && result.cnpj) {
                    return result; // Success
                }
            }
            console.warn(`Attempt ${attempt}: MinhaReceita API request failed or returned invalid data. Retrying...`);
        } catch (error) {
            console.error(`Attempt ${attempt}: Error during MinhaReceita API fetch:`, error);
        }
        if (attempt < MAX_RETRIES) await delay(RETRY_DELAY_MS);
    }
    console.error(`All ${MAX_RETRIES} attempts to fetch data from MinhaReceita failed.`);
    return null;
}

// =================================================================================
// ==================== 4. DYNAMIC UI RENDERING & UPDATING =========================
// =================================================================================
// Functions that build and update the main HTML structure of the results card.
// ---------------------------------------------------------------------------------

/**
 * Renders the main company card using data from the ReceitaWS API.
 * Includes a placeholder for "Inscrição Estadual" data, which will be loaded separately.
 * @param {object} data - The data object from the consultarReceitaWS call.
 * @param {HTMLElement} container - The container element to inject the HTML into.
 */
function renderCardFromReceitaWS(data, container) {
    // Map status text to user-friendly text and CSS classes
    const situacao = data.situacao || 'DESCONHECIDO';
    const statusMap = {
        'ATIVA': { text: 'Ativa', class: 'status-active' },
        'SUSPENSA': { text: 'Suspensa', class: 'status-warning' },
        'INAPTA': { text: 'Inapta', class: 'status-warning' },
        'BAIXADA': { text: 'Baixada', class: 'status-inactive' },
        'NULA': { text: 'Nula', class: 'status-warning' }
    };
    const statusInfo = statusMap[situacao.toUpperCase()] || { text: situacao, class: 'status-warning' };

    // --- THIS IS THE KEY ---
    // The tax regime info is determined synchronously from the data we already have.
    // No new API call is needed here.
    const taxRegimeInfo = getTaxRegimeInfo(data);

    // Generate complex HTML sections using helper functions
    const contatoHTML = gerarContatoHTML(data.telefone, data.email);
    const sociosHTML = gerarSociosHTML(data.qsa);
    const atividadesSecundariasHTML = gerarAtividadesSecundariasHTML(data.atividades_secundarias);

    container.innerHTML = `
        <div class="company-card">
            <div id="card-warning-message-container"></div>
            <div class="company-header">
                <div class="company-info-left">
                    <div class="company-name">${data.fantasia || data.nome || 'N/A'}</div>
                    <div class="company-cnpj copyable" onclick="copyToClipboard(this)">${formatarCNPJ(data.cnpj || '')}</div>
                </div>
                <div class="status-container">
                    <!--
                        THE FIX: The tax regime and status are rendered directly.
                        There is no placeholder or spinner here.
                    -->
                    <div class="${taxRegimeInfo.class}">${taxRegimeInfo.text}</div>
                    <div class="status-badge ${statusInfo.class}">${statusInfo.text}</div>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-card">
                    <h3>📋 Informações Básicas</h3>
                    <p><strong>Razão Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.nome || 'N/A'}</span></p>
                    <p><strong>Nome Fantasia:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.fantasia || 'N/A'}</span></p>
                    <p><strong>Data de Abertura:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.abertura || 'N/A'}</span></p>
                    <p><strong>Porte:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.porte || 'N/A'}</span></p>
                    <p><strong>Capital Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarCapital(data.capital_social)}</span></p>
                </div>
                <div class="info-card" id="economic-activity-card">
                    <h3>🏭 Atividade Econômica</h3>
                    <p><strong>Atividade Principal:</strong></p>
                    <p>${data.atividade_principal?.[0]?.text || 'N/A'}</p>
                    <p><strong>Código CNAE:</strong> ${data.atividade_principal?.[0]?.code || 'N/A'}</p>
                    <p><strong>Natureza Jurídica:</strong> ${data.natureza_juridica || 'N/A'}</p>
                    ${atividadesSecundariasHTML}
                </div>
                <div class="info-card">
                    <h3>📍 Endereço</h3>
                    <p><strong>Logradouro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.logradouro || 'N/A'}</span></p>
                    <p><strong>Número:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.numero || 'S/N'}</span></p>
                    ${data.complemento ? `<p><strong>Complemento:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.complemento}</span></p>` : ''}
                    <p><strong>Bairro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.bairro || 'N/A'}</span></p>
                    <p><strong>Cidade/UF:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.municipio || 'N/A'}</span> / <span class="copyable" onclick="copyToClipboard(this)">${data.uf || 'N/A'}</span></p>
                    <p><strong>CEP:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${limparCEP(data.cep)}</span></p>
                </div>
                <div class="info-card">
                    <h3>📞 Contato</h3>
                    ${contatoHTML}
                </div>
            </div>
            <div class="info-grid" id="secondary-grid">
                <!-- Placeholder for IE, which comes from the secondary API -->
                <div id="ie-card-container">
                     <div class="info-card">
                        <h3>🎯 Inscrições Estaduais</h3>
                        <div class="mini-spinner"></div>
                     </div>
                </div>
                ${sociosHTML}
            </div>
        </div>
    `;
}


/**
 * Renders the company card using data from the fallback API (CNPJ.A).
 * This is triggered when the primary ReceitaWS API fails.
 * @param {object} data - The data object from the consultarCNPJA_API call.
 * @param {HTMLElement} container - The container element to inject the HTML into.
 */
function renderCardFromCNPJA(data, container) {
    const company = data.company || {};
    const address = data.address || {};

    // Map status from CNPJ.A data
    const statusMap = {
        1: { text: 'Ativa', class: 'status-active' },
        2: { text: 'Ativa', class: 'status-active' },
        3: { text: 'Suspensa', class: 'status-warning' },
        4: { text: 'Inapta', class: 'status-warning' },
        8: { text: 'Baixada', class: 'status-inactive' }
    };
    const statusInfo = statusMap[data.status?.id] || { text: 'Desconhecido', class: 'status-warning' };

    // Determine tax regime from CNPJ.A data
    const taxRegimeInfo = getTaxRegimeInfo(data);

    // Generate HTML for dynamic sections using universal helpers
    const contatoHTML = gerarContatoHTML(data.phones, data.emails);
    const ieHTML = gerarIEHTML(data.registrations, address.state);
    const sociosHTML = gerarSociosHTML(data.company?.members);
    const atividadesSecundariasHTML = gerarAtividadesSecundariasHTML(data.sideActivities);
    const secondGridHTML = (ieHTML || sociosHTML) ? `<div class="info-grid">${ieHTML}${sociosHTML}</div>` : '';

    container.innerHTML = `
        <div class="company-card">
            <div id="card-warning-message-container"></div>
            <div class="company-header">
                <div class="company-info-left">
                    <div class="company-name">${data.alias || company.name || 'N/A'}</div>
                    <div class="company-cnpj copyable" onclick="copyToClipboard(this)">${formatarCNPJ(data.taxId || '')}</div>
                </div>
                <div class="status-container">
                    <div class="${taxRegimeInfo.class}">${taxRegimeInfo.text}</div>
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
                    <p><strong>Natureza Jurídica:</strong> ${company.nature?.text || 'N/A'}</p>
                    ${atividadesSecundariasHTML}
                </div>
                <div class="info-card">
                    <h3>📍 Endereço</h3>
                    <p><strong>Logradouro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.street || 'N/A'}</span></p>
                    <p><strong>Número:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.number || 'S/N'}</span></p>
                    ${address.details ? `<p><strong>Complemento:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.details}</span></p>` : ''}
                    <p><strong>Bairro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.district || 'N/A'}</span></p>
                    <p><strong>Cidade/UF:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${address.city || 'N/A'}</span> / <span class="copyable" onclick="copyToClipboard(this)">${address.state || 'N/A'}</span></p>
                    <p><strong>CEP:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${limparCEP(address.zip)}</span></p>
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
 * Updates the card with "Inscrição Estadual" data from the CNPJ.A API.
 * @param {object|null} cnpjaData - Data from CNPJ.A API, or null if it failed.
 * @param {string} mainState - The state (UF) of the company to highlight the main IE.
 */
function updateCardWithIEData(cnpjaData, mainState) {
    const ieContainer = document.getElementById('ie-card-container');
    if (!ieContainer) return;

    // Check if there is data and registrations exist
    if (cnpjaData && cnpjaData.registrations && cnpjaData.registrations.length > 0) {
        // Use the existing helper to generate the HTML for the IE card
        const ieHTML = gerarIEHTML(cnpjaData.registrations, mainState);
        ieContainer.innerHTML = ieHTML;
    } else {
        // If no data or no registrations, show a message.
        ieContainer.innerHTML = `
            <div class="info-card">
                <h3>🎯 Inscrições Estaduais</h3>
                <p>Nenhuma Inscrição Estadual encontrada.</p>
            </div>
        `;
    }
}

/**
 * Renders the company card using data from the MinhaReceita API.
 * This is used as a fast secondary source.
 * @param {object} data - The data object from the consultarMinhaReceitaAPI call.
 * @param {HTMLElement} container - The container element to inject the HTML into.
 */
function renderCardFromMinhaReceita(data, container) {
    const statusMap = { 'ATIVA': { text: 'Ativa', class: 'status-active' } };
    const statusInfo = statusMap[data.descricao_situacao_cadastral] || { text: data.descricao_situacao_cadastral, class: 'status-warning' };
    const taxRegimeInfo = getTaxRegimeInfo(data);
    const contatoHTML = gerarContatoHTML(data, null); // Pass the whole object
    const sociosHTML = gerarSociosHTML(data.qsa);
    const atividadesSecundariasHTML = gerarAtividadesSecundariasHTML(data.cnaes_secundarios);

    container.innerHTML = `
        <div class="company-card">
            <div id="card-warning-message-container"></div>
            <div class="company-header">
                <div class="company-info-left">
                    <div class="company-name">${data.nome_fantasia || data.razao_social || 'N/A'}</div>
                    <div class="company-cnpj copyable" onclick="copyToClipboard(this)">${formatarCNPJ(data.cnpj || '')}</div>
                </div>
                <div class="status-container">
                    <div class="${taxRegimeInfo.class}">${taxRegimeInfo.text}</div>
                    <div class="status-badge ${statusInfo.class}">${statusInfo.text}</div>
                </div>
            </div>
            <div class="info-grid">
                <div class="info-card">
                    <h3>📋 Informações Básicas</h3>
                    <p><strong>Razão Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.razao_social || 'N/A'}</span></p>
                    <p><strong>Data de Abertura:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarData(data.data_inicio_atividade) || 'N/A'}</span></p>
                    <p><strong>Porte:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.porte || 'N/A'}</span></p>
                    <p><strong>Capital Social:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarCapital(data.capital_social)}</span></p>
                </div>
                <div class="info-card" id="economic-activity-card">
                    <h3>🏭 Atividade Econômica</h3>
                    <p><strong>Atividade Principal:</strong></p>
                    <p>${data.cnae_fiscal_descricao || 'N/A'}</p>
                    <p><strong>Código CNAE:</strong> ${data.cnae_fiscal || 'N/A'}</p>
                    <p><strong>Natureza Jurídica:</strong> ${data.natureza_juridica || 'N/A'}</p>
                    ${atividadesSecundariasHTML}
                </div>
                <div class="info-card">
                    <h3>📍 Endereço</h3>
                    <p><strong>Logradouro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.logradouro || 'N/A'}</span></p>
                    <p><strong>Número:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.numero || 'S/N'}</span></p>
                    <p><strong>Bairro:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.bairro || 'N/A'}</span></p>
                    <p><strong>Cidade/UF:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${data.municipio || 'N/A'}</span> / <span class="copyable" onclick="copyToClipboard(this)">${data.uf || 'N/A'}</span></p>
                    <p><strong>CEP:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${limparCEP(data.cep)}</span></p>
                </div>
                <div class="info-card">
                    <h3>📞 Contato</h3>
                    ${contatoHTML}
                </div>
            </div>
            <div class="info-grid" id="secondary-grid">
                <div id="ie-card-container">
                     <div class="info-card">
                        <h3>🎯 Inscrições Estaduais</h3>
                        <div class="mini-spinner"></div>
                     </div>
                </div>
                ${sociosHTML}
            </div>
        </div>
    `;
}

// =================================================================================
// ==================== 5. HTML STRING GENERATION HELPERS ==========================
// =================================================================================
// Functions that generate specific, smaller pieces of HTML for the results card.
// ---------------------------------------------------------------------------------

/**
 * Determines the company's tax regime from a full API response object.
 * This final version correctly inspects the nested "optante" property for all API structures,
 * including ReceitaWS.
 * @param {object} data - The full data object from any of the three APIs.
 * @returns {{text: string, class: string}} An object with the display text and CSS class.
 */
function getTaxRegimeInfo(data) {
    if (!data) {
        return { text: 'Trib: Outros', class: 'tax-regime-bar' };
    }

    // Use optional chaining (?.) to safely check nested properties without errors.

    // --- 1. Check for SIMEI ---
    if (
        (data.company?.simei?.optant === true) ||  // Handles CNPJ.A structure
        (data.opcao_pelo_mei === true) ||          // Handles MinhaReceita structure
        (data.simei?.optante === true)             // Handles ReceitaWS structure <-- THE CRITICAL FIX
    ) {
        return { text: 'S I M E I', class: 'tax-regime-bar' };
    }

    // --- 2. Check for Simples Nacional ---
    if (
        (data.company?.simples?.optant === true) || // Handles CNPJ.A structure
        (data.opcao_pelo_simples === true) ||       // Handles MinhaReceita structure
        (data.simples?.optant === true)             // Handles ReceitaWS structure <-- THE CRITICAL FIX
    ) {
        return { text: 'Simples', class: 'tax-regime-bar' };
    }
    
    // --- 3. Check for an explicit "Normal Regime" status ---
    if (
        (data.company?.simples?.optant === false) ||
        (data.opcao_pelo_simples === false) ||
        (data.simples?.optant === false)
    ) {
        return { text: 'Trib: Normal', class: 'tax-regime-bar' };
    }

    // --- 4. Fallback if no specific data is found ---
    return { text: 'Trib: Outros', class: 'tax-regime-bar' };
}





/**
 * Creates the HTML for secondary activities from any API source.
 * @param {Array<object>} activities - An array of secondary activity objects.
 * @returns {string} The generated HTML string.
 */
function gerarAtividadesSecundariasHTML(activities) {
    if (!activities || activities.length === 0) return '';
    const total = activities.length;
    const limit = 2;

    const createActivityHTML = a => {
        const text = a.text || a.descricao || 'N/A'; // Support all sources
        const code = a.id || a.code || a.codigo || 'N/A';
        return `<p class="activity-item">• ${text} (${code})</p>`;
    };

    const visibleHtml = activities.slice(0, limit).map(createActivityHTML).join('');
    let hiddenHtml = '', toggleButtonHtml = '';

    if (total > limit) {
        const remaining = activities.slice(limit);
        hiddenHtml = `<div id="hidden-activities" class="hidden">${remaining.map(createActivityHTML).join('')}</div>`;
        toggleButtonHtml = `<p id="toggle-activities-btn" class="toggle-link" data-remaining-count="${remaining.length}" onclick="toggleSecondaryActivities()">Ver mais ${remaining.length}...</p>`;
    }

    return `<div class="secondary-activities-container"><p style="margin-top: 12px;"><strong>Atividades Secundárias (${total}):</strong></p>${visibleHtml}${hiddenHtml}${toggleButtonHtml}</div>`;
}

/**
 * Creates the HTML for contact info from any API source.
 * @param {object|Array|string|null} primaryData - Phone/email data (or the whole object for MinhaReceita).
 * @param {Array|string|null} secondaryData - Email data.
 * @returns {string} The generated HTML string.
 */
function gerarContatoHTML(primaryData, secondaryData) {
    let html = '';
    let phones = primaryData, emails = secondaryData;

    // Handle MinhaReceita object structure
    if (typeof primaryData === 'object' && !Array.isArray(primaryData) && primaryData !== null) {
        const phone1 = primaryData.ddd_telefone_1 ? formatarTelefone(primaryData.ddd_telefone_1) : null;
        const phone2 = primaryData.ddd_telefone_2 ? formatarTelefone(primaryData.ddd_telefone_2) : null;
        html += `<p><strong>Telefone:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${phone1 || 'N/A'}</span></p>`;
        if (phone2) html += `<p><strong>Telefone 2:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${phone2}</span></p>`;
        html += `<p><strong>Email:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${primaryData.email || 'N/A'}</span></p>`;
        return html;
    }

    // Handle CNPJ.A / ReceitaWS structures
    if (Array.isArray(phones) && phones.length > 0) {
        html += phones.slice(0, 2).map((p, i) => `<p><strong>Telefone ${i + 1}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarTelefone(p.number)}</span></p>`).join('');
    } else if (typeof phones === 'string' && phones) {
        html += `<p><strong>Telefone:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${formatarTelefone(phones)}</span></p>`;
    } else {
        html += '<p><strong>Telefone:</strong><br><span class="copyable">N/A</span></p>';
    }

    if (Array.isArray(emails) && emails.length > 0) {
        html += emails.slice(0, 2).map((e, i) => `<p><strong>Email ${i + 1}:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${e.address || 'N/A'}</span></p>`).join('');
    } else if (typeof emails === 'string' && emails) {
        html += `<p><strong>Email:</strong><br><span class="copyable" onclick="copyToClipboard(this)">${emails}</span></p>`;
    } else if (!emails) {
        html += '<p><strong>Email:</strong><br><span class="copyable">N/A</span></p>';
    }
    return html;
}


/**
 * Creates the HTML for the state registrations (Inscrições Estaduais) card.
 * (Unchanged, as it relies on the CNPJ.A data structure)
 * @param {Array<object>} registrations - An array of registration objects.
 * @param {string} mainState - The primary state of the company's address to highlight.
 * @returns {string} The generated HTML string, or an empty string if it shouldn't be rendered.
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
 * Creates the HTML for the company members from any API source.
 * @param {Array<object>} members - An array of member objects.
 * @returns {string} The generated HTML string.
 */
function gerarSociosHTML(members) {
    if (!members || members.length === 0) return '';
    let html = `<div class="info-card"><h3>👥 Quadro Societário (${members.length})</h3>`;
    html += members.slice(0, 8).map(m => {
        const name = m.person?.name || m.nome || m.nome_socio || 'N/A';
        const role = m.role?.text || m.qual || m.qualificacao_socio || 'Sócio';
        return `<p>• ${name}<br><em>${role}</em></p>`;
    }).join('');
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
/** Delays execution for a specified number of milliseconds. */
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

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

/** Removes all non-numeric characters from a CEP string for display. */
function limparCEP(cep) {
    if (!cep) return 'N/A'; // Return 'N/A' if the input is null or empty
    return cep.replace(/[^0-9]/g, '');
}

// =================================================================================
// ==================== 7. UI INTERACTION & FEEDBACK ===============================
// =================================================================================
// Functions that manage UI state, animations, and user feedback actions.
// ---------------------------------------------------------------------------------

/**
 * Inserts a dismissible warning message at the top of the company card.
 * @param {string} mensagem - The warning message to display.

function addWarningMessage(mensagem) {
    const container = document.getElementById('card-warning-message-container');
    if (container) {
        // Use a different class for warnings vs. errors
        container.innerHTML = `<div class="success-message" style="background: #fff3cd; color: #856404; margin-bottom: 15px;">⚠️ ${mensagem}</div>`;
    }
}
**/

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